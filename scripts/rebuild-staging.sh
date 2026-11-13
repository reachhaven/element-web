#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# Rebuilds staging/web, the branch the image is built from (README.md,
# "Branches"): develop, then config/web-image, then every feat/* and fix/*
# branch with an open pull request against this repository, in name order,
# each joined by a signed merge commit "chore(staging): merge <branch>". A
# branch that develop or a branch before it already contains is left out.
# The merges need no checkout (git merge-tree, git 2.38 or later), so no
# working tree changes. staging/web moves only when every merge is clean, and
# not at all when it already joins exactly these commits in clean merges.
#
# Usage: scripts/rebuild-staging.sh [--offline] [--no-sign] [--remote <name>]
#
#   By default the branches are the remote's, fetched first, and gh lists the
#   open pull requests of the remote's repository, or of GH_REPO when it is
#   set. Pull requests from other repositories are left out.
#   --offline   merge the local develop, config/web-image and every local
#               feat/* and fix/* branch instead, without the network
#   --no-sign   leave the merge commits unsigned, for automation without a key
#   --remote    the remote that is this repository; origin by default
#
# It ends with a summary and the command that publishes the result. Exit
# status: 0 when staging/web is rebuilt or already up to date, 3 on a merge
# conflict, which leaves staging/web as it was, anything else on an error. In
# GitHub Actions it also sets the step outputs previous (the remote's
# staging/web, empty when there is none), head, changed (true when head differs
# from previous) and, on a conflict, conflict (the branch).

set -euo pipefail
shopt -s inherit_errexit

staging=staging/web
subject="chore(staging): merge "
tab=$'\t'
nl=$'\n'

die() {
    printf '%s\n' "$*" >&2
    exit 2
}

output() {
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
    fi
}

offline=false
sign=--gpg-sign
remote=origin
while [ $# -gt 0 ]; do
    case $1 in
        --offline) offline=true ;;
        --no-sign) sign=--no-gpg-sign ;;
        --remote)
            [ $# -gt 1 ] || die "--remote needs the name of a remote."
            remote=$2
            shift
            ;;
        -h | --help)
            sed -n '/^# Rebuilds/,/^$/s/^# \{0,1\}//p' "$0"
            exit 0
            ;;
        *) die "Unknown argument $1; see $0 --help." ;;
    esac
    shift
done

# git refuses to move a branch that a checkout has; say so before merging.
checked_out=$(git worktree list --porcelain | awk -v branch="branch refs/heads/$staging" '
    /^worktree / { path = substr($0, 10) }
    $0 == branch { print path }')
if [ -n "$checked_out" ]; then
    die "$staging is checked out in $checked_out. Switch that checkout to another branch, or detach it with git switch --detach, and run this again."
fi

# The branches to merge after config/web-image, as <name><tab><note> lines.
if "$offline"; then
    refs=refs/heads
    where=here
    branches=$(git for-each-ref --format='%(refname:strip=2)' refs/heads/feat refs/heads/fix)
else
    refs=refs/remotes/$remote
    where="on $remote"
    command -v gh > /dev/null || die "gh lists the open pull requests: install it, or pass --offline to merge the local branches."
    if [ -n "${GH_REPO:-}" ]; then
        repo=$GH_REPO
    else
        repo=$(git remote get-url "$remote") || die "There is no remote $remote; name the remote of this repository with --remote."
    fi
    git fetch --quiet --no-tags --prune "$remote" "+refs/heads/*:$refs/*" ||
        die "Could not fetch $remote. Pass --offline to merge the local branches."
    branches=$(gh pr list --repo "$repo" --state open --limit 1000 \
        --json headRefName,isCrossRepository,isDraft,labels \
        --jq '[.[] | select((.isCrossRepository | not) and (.isDraft | not) and (.headRefName | test("^(feat|fix)/")))]
            | group_by(.headRefName)[]
            | [.[0].headRefName, (if any(.[].labels[]; .name == "fork-only") then "fork-only" else "" end)]
            | @tsv') ||
        die "gh could not list the open pull requests of $repo. Sign in with gh auth login, or pass --offline to merge the local branches."
fi

commit_of() {
    git rev-parse --verify --quiet "$refs/$1^{commit}" || die "There is no branch $1 $where."
}

base=$(commit_of develop)
sorted=$(printf '%s\n' "$branches" | LC_ALL=C sort -t "$tab" -k1,1)
commit=$(commit_of config/web-image)
names=(config/web-image)
commits=("$commit")
notes=("")
while IFS=$tab read -r name note; do
    case $name in
        feat/* | fix/*) ;;
        *) continue ;;
    esac
    git check-ref-format --branch "$name" > /dev/null 2>&1 || die "$name is not a valid branch name."
    commit=$(commit_of "$name")
    names+=("$name")
    commits+=("$commit")
    notes+=("$note")
done <<< "$sorted"

# Leave out what develop or a branch merged before it already contains.
plan=()
for i in "${!names[@]}"; do
    contained=false
    for other in "$base" "${plan[@]%% *}"; do
        if git merge-base --is-ancestor "${commits[i]}" "$other"; then
            contained=true
            break
        fi
    done
    if "$contained"; then
        notes[i]="left out: develop or a branch before it has it"
    else
        plan+=("${commits[i]} ${names[i]}")
    fi
done

# What a staging/web commit was built from: its base, then <commit> <branch>
# for each merge, oldest first. A merge whose tree is not what merging its
# parents gives, such as a conflict resolved by hand, makes it no rebuild.
built_from() {
    local commit=$1 line message tree clean merges=()
    local -a parents
    while :; do
        line=$(git log -1 --format="%T %P$tab%s" "$commit")
        message=${line#*"$tab"}
        tree=${line%% *}
        read -r -a parents <<< "${line%%"$tab"*}"
        parents=("${parents[@]:1}")
        if [ "${#parents[@]}" -ne 2 ] || [[ $message != "$subject"* ]]; then
            break
        fi
        clean=$(git merge-tree --write-tree --name-only "${parents[0]}" "${parents[1]}") || clean=""
        if [ "${clean%%"$nl"*}" != "$tree" ]; then
            echo "$commit is not a clean merge of its parents"
            return 0
        fi
        merges=("${parents[1]} ${message#"$subject"}" "${merges[@]}")
        commit=${parents[0]}
    done
    printf '%s\n' "$commit" "${merges[@]}"
}

# Keep the remote's staging/web, or else this one, when it already joins
# exactly these commits.
previous=$(git rev-parse --verify --quiet "refs/remotes/$remote/$staging^{commit}" || true)
mine=$(git rev-parse --verify --quiet "refs/heads/$staging^{commit}" || true)
planned=$(printf '%s\n' "$base" "${plan[@]}")
head=""
for candidate in "$previous" "$mine"; do
    if [ -n "$candidate" ]; then
        built=$(built_from "$candidate")
        if [ "$built" = "$planned" ]; then
            head=$candidate
            break
        fi
    fi
done
if [ -n "$head" ]; then
    rebuilt=false
else
    rebuilt=true
    ident=$(git var GIT_COMMITTER_IDENT)
    ident=${ident% *}
    ident=${ident% *}
    head=$base
    merged="develop (${base:0:12})"
    for entry in "${plan[@]}"; do
        commit=${entry%% *}
        name=${entry#* }
        status=0
        result=$(git merge-tree --write-tree --name-only "$head" "$commit") || status=$?
        tree=${result%%"$nl"*}
        if [ "$status" -eq 1 ] && [[ $tree =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]]; then
            {
                echo "Merging $name (${commit:0:12}) into $staging conflicts with $merged:"
                printf '%s\n' "${result#*"$nl$nl"}" | grep '^CONFLICT' | sed 's/^/  /' || true
                echo "$staging is left as it was. Rebase $name onto develop, or onto config/web-image if it is built on that, resolve the conflict, amend its commit, push it with --force-with-lease, and run this again."
            } >&2
            output previous "$previous"
            output conflict "$name"
            exit 3
        elif [ "$status" -ne 0 ]; then
            die "git merge-tree could not merge $name (it needs git 2.38 or later)."
        fi
        head=$(git commit-tree "$sign" -p "$head" -p "$commit" -m "$subject$name" -m "Signed-off-by: $ident" "$tree") ||
            die "git could not make the merge commit for $name. Without a signing key, pass --no-sign."
        merged="$merged, $name"
    done
fi
git branch --force --no-track "$staging" "$head" > /dev/null

changed=false
if [ "$head" != "$previous" ]; then
    changed=true
fi
output previous "$previous"
output head "$head"
output changed "$changed"

if "$rebuilt"; then
    echo "$staging is now ${head:0:12}, rebuilt from:"
else
    echo "$staging is ${head:0:12} and already joins exactly these commits:"
fi
width=7
for name in "${names[@]}"; do
    width=$((${#name} > width ? ${#name} : width))
done
printf '  %-*s  %s\n' "$width" develop "${base:0:12}"
for i in "${!names[@]}"; do
    printf '  %-*s  %s  %s\n' "$width" "${names[i]}" "${commits[i]:0:12}" "${notes[i]}" | sed 's/ *$//'
done
if "$changed"; then
    echo "Publish it: git push --force-with-lease=refs/heads/$staging:$previous $remote $staging"
fi
