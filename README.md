[![Chat](https://img.shields.io/matrix/element-web:matrix.org?logo=matrix)](https://matrix.to/#/#element-web:matrix.org)
![Tests](https://github.com/element-hq/element-web/actions/workflows/tests.yaml/badge.svg)
![Static Analysis](https://github.com/element-hq/element-web/actions/workflows/static_analysis.yaml/badge.svg)
[![Localazy](https://img.shields.io/endpoint?url=https%3A%2F%2Fconnect.localazy.com%2Fstatus%2Felement-web%2Fdata%3Fcontent%3Dall%26title%3Dlocalazy%26logo%3Dtrue)](https://localazy.com/p/element-web)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=element-web&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=element-web)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=element-web&metric=coverage)](https://sonarcloud.io/summary/new_code?id=element-web)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=element-web&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=element-web)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=element-web&metric=bugs)](https://sonarcloud.io/summary/new_code?id=element-web)

# Element

Element (formerly known as Vector and Riot) is a Matrix web & desktop client built using the [Matrix
JS SDK](https://github.com/matrix-org/matrix-js-sdk).

# Deployment contract

This fork builds a white-label web image, `ghcr.io/<owner>/element-web:<commit>`, from its integration branch
`staging/web`. This section and the next, "Branches", are the fork's; everything after them is upstream's README.

The image is the `element_web` stage of upstream's `apps/web/Dockerfile` with start scripts on top (`deploy/web/`).
nginx serves the app as the unprivileged `nginx` user on port 80 (`ELEMENT_WEB_PORT`), over IPv4 and IPv6, and
`GET /` returns it. `/`, `/index.html`, `/config.json`, `/version`, `/manifest.json`, `/i18n/`, `/brand/` and the
icons and logos under `/vector-icons/` and `/themes/element/img/logos/` answer with `Cache-Control: no-cache`. The
image contains busybox `wget` for health checks such as `wget -q --spider http://127.0.0.1:80/`. The start scripts
write into the web root and `/etc/nginx/element-web`, so the root file system must be writable; they run as `nginx`
or as any other user ID in the root group. Modules mounted at
`/modules` load as `docs/install.md` describes.

## Environment

| Variable                  | Used for                                                                                                                                                                                                                                                                                                                   | When it is not set                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_CLIENT_HOMESERVER`   | the server name of the homeserver: `default_server_config["m.homeserver"]` gets `base_url` `https://<WEB_CLIENT_HOMESERVER>` and `server_name`. Element looks up no `.well-known` then, so the server name must serve the client-server API itself                                                                         | the container stops with an error                                                                                               |
| `WEB_CLIENT_URL`          | the public URL of the app, http or https, without query or fragment; trailing slashes are dropped. It sets `branding.logo_link_url` and `oidc_metadata`: `client_uri` (the URL), `policy_uri` and `tos_uri` (`<WEB_CLIENT_URL>/privacy`), and `logo_uri` (`<WEB_CLIENT_URL>/brand/logo.png`) when `/brand/logo.png` exists | the container stops with an error                                                                                               |
| `WEB_CLIENT_APP_NAME`     | `brand`: the name in the app, the page title, the PWA name and the OAuth client name                                                                                                                                                                                                                                       | `brand` from `/brand/config.json`; without either, the container stops with an error                                            |
| `WEB_CLIENT_PRIVACY_URL`  | where `/privacy` redirects with a 302                                                                                                                                                                                                                                                                                      | `/privacy` answers 404                                                                                                          |
| `WEB_CLIENT_WELCOME_TEXT` | nothing: Element Web has no welcome text, which the start log notes. With `sso_redirect_options.immediate` it shows no welcome page either; `embedded_pages.welcome_url` in `/brand/config.json` can name one                                                                                                              |                                                                                                                                 |
| `WEB_CLIENT_SOURCE_URL`   | `source_code_url`, the source of the running version                                                                                                                                                                                                                                                                       | `<SOURCE_REPOSITORY_URL>/tree/<SOURCE_COMMIT>` of the build; an image built without both stops with an error unless this is set |

A malformed value stops the container with a message that names it. Sign-in registers the app as an OAuth 2.0 client at
the homeserver's authorization server (dynamic client registration with `oidc_metadata`). MAS accepts only a client
whose redirect URI, logo, terms and policy sit on the host of its client URI. The image sets the client URI, terms,
policy and brand logo from `WEB_CLIENT_URL`, while Element takes the redirect URI, and the logo when there is no
`logo.png`, from the address it is opened at; serve the app at `WEB_CLIENT_URL`.

## Configuration

`/config.json` is written at every start from three layers, each merged over the one before: the image's defaults
(`deploy/web/config.json`, plus the modules from `/modules`), `/brand/config.json`, then the variables above. Objects
merge key by key; every other value, arrays included, replaces the one before. A `/brand/config.json` that is not one
JSON object stops the container. The defaults:

- `disable_custom_urls`, `disable_guests` and `disable_3pid_login` are on, `show_labs_settings` is off.
- `sso_redirect_options.immediate`: people go straight to the homeserver's sign-in.
- `features.feature_wysiwyg_composer`: the rich text composer.
- `default_theme` is `light`; `room_directory.servers` is empty, which leaves the homeserver's own directory.
- `setting_defaults` turns off `UIFeature.identityServer` and `UIFeature.shareSocial`.
- No integration manager (`integrations_ui_url`, `integrations_rest_url`, `integrations_widgets_urls`) and no prompts
  for Element's own apps (`mobile_guide_toast`, `desktop_builds.available`, `mobile_builds`).
- `branding.auth_header_logo_url` is `brand/logo.svg`, else `brand/logo.png`, when that file exists.

## Brand directory

A directory mounted at `/brand` carries the brand and is served at `/brand/`. Every file is optional:

| File in `/brand`                 | Replaces                                                                                                                       | Shown as                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `config.json`                    | merged into `/config.json` between the image's defaults and the variables                                                      | any key of `docs/config.md`, for example `setting_defaults.custom_themes` and `default_theme` (`docs/theming.md`) |
| `favicon.png`                    | `/vector-icons/24.png` and the hashed copy `index.html` links                                                                  | the browser tab icon                                                                                              |
| `icons/Icon-<size>.png`          | every other `/vector-icons/<size>.png` and its hashed copy, with the smallest brand icon at least that large, else the largest | page, touch and PWA icons; `1024.png` is the OAuth client logo when there is no `logo.png`                        |
| `icons/Icon-maskable-<size>.png` | added to `/manifest.json` with `purpose` `maskable`                                                                            | the icon on Android home screens                                                                                  |
| `logo.svg`                       | `/themes/element/img/logos/element-logo.svg`                                                                                   | the logo above sign-in, recovery and device verification                                                          |
| `logo.png`                       | `/themes/element/img/logos/element-app-logo.png`                                                                               | the logo of the error page; also the OAuth client logo and `og:image`                                             |
| `manifest.json`                  | merged into `/manifest.json`                                                                                                   | for example `theme_color` and `background_color`                                                                  |

Element has no place for `logo_mono.png`. The name goes into the page title, the `apple-mobile-web-app-title` and
`application-name` tags, and `name` and `short_name` of `/manifest.json`, which also drops Element's
`related_applications`. `og:image` names `oidc_metadata.logo_uri` when that is set and is dropped otherwise. Every start begins from the
image's own copies of these files, so a file removed from `/brand` goes back to Element's.

## Building

The base comes from a clone, not a worktree: upstream's Dockerfile bind-mounts `.git`, which is a file in a worktree.
It also names the build from git, after the tag on a detached HEAD. So check out the commit detached with its build
tag, as the image workflow does; the app's version is then that tag. Until `fix/get-version-without-jq` is merged into
`staging/web`, build from the tag in any case: on a branch other than `develop`, upstream's version script needs `jq`,
which its builder lacks.

```sh
git clone https://github.com/<owner>/element-web.git element-web-build
cd element-web-build
git checkout --detach origin/staging/web
commit=$(git rev-parse --short=12 HEAD)
git tag --no-sign --force "build/$(date -u +%Y%m%d)-$commit"
docker build --file apps/web/Dockerfile --target element_web --tag "element-web-base:$commit" .
docker build --file deploy/web/Dockerfile \
    --build-arg BASE_IMAGE="element-web-base:$commit" \
    --build-arg SOURCE_REPOSITORY_URL=https://github.com/<owner>/element-web \
    --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
    --tag element-web:local deploy/web
deploy/web/test-image.sh element-web:local
```

`deploy/web/test-image.sh` starts the image with an invented brand, checks this contract over HTTP, then checks that
bad settings stop it.

## Source

The `Web image` workflow builds every push to `staging/web`: the white-label guard and the licence check first, then
both stages from the commit with its build tag `build/<yyyymmdd>-<12-character commit>`, then `deploy/web/test-image.sh`.
Only then does it push the tag and `ghcr.io/<owner>/element-web:<commit>`; the tags are never deleted. The image carries
the `org.opencontainers.image.source` and `org.opencontainers.image.revision` labels, and `source_code_url` names the
exact code of the running version and stays valid after `staging/web` is rebuilt. Section 13 of the AGPL asks a
deployment to offer that source to the people who use the app; see the limits below.

## Limits

Until `feat/config-source-code-url` is merged into `staging/web`, Element Web does not read `source_code_url`, and a
deployment has to offer the source another way. The pages for browsers
Element cannot run in (`/static/`) and the mobile guide (`/mobile_guide/`) keep Element's name and look, and
`help_url`, `help_encryption_url`, `help_key_storage_url` and `jitsi.preferred_domain` point at Element's services
until `/brand/config.json` sets them.

# Branches

The fork takes in upstream's `develop` every day, keeps every change of its own as a pull request against itself, and
builds and deploys `staging/web`, which merges them all.

- `develop` mirrors upstream's `develop`. It only ever moves forward to upstream's commit (fast-forward), and nobody
  commits to it. The `Sync upstream` workflow pulls it in every day; by hand, in a clone with upstream as a remote:
  `git fetch upstream && git push origin upstream/develop:develop`.
- `config/web-image` holds what only this fork needs: the image (`deploy/web/`), `scripts/rebuild-staging.sh`, the
  `Web image`, `White label` and `Sync upstream` workflows, the guards on upstream's workflows, `CLAUDE.md`,
  `REUSE.toml`, `LICENSES/` and these two sections. It is long-lived and never goes upstream. When it conflicts with
  `develop`, rebase it onto `develop` and push it with `--force-with-lease`.
- `feat/<subject>` and `fix/<subject>` carry one change each: branched from `develop`, exactly one commit in
  Conventional Commits form with a scope (`feat(composer): …`), signed and signed off (`git commit -s -S`). Each has a
  pull request against the fork's `develop` and is reviewed there. Changes from the review are amended into the one
  commit and pushed with `git push --force-with-lease` for as long as the pull request is open. They are written to
  upstream's standard (`CONTRIBUTING.md`, `code_style.md`, tests), so they could go upstream as they are.
- Fork-only branches hold changes upstream would never take, such as `feat/web-e2e`, the end-to-end suite in
  `deploy/e2e`. They follow the same rules, and their pull request carries the label `fork-only` (create it once with
  `gh label create fork-only`). One that builds on `config/web-image` starts from it and its pull request targets it,
  as with `feat/web-e2e`. When `config/web-image` is rewritten, move the branch's one commit onto it with
  `git rebase --onto origin/config/web-image HEAD~1`.
- `staging/web` is what gets built and deployed. It is rebuilt from scratch and never developed on: `develop`, then
  `config/web-image`, then every `feat/*` and `fix/*` branch with an open, non-draft pull request against the fork, in name
  order, each joined by a merge commit `chore(staging): merge <branch>`. A branch that `develop`, or a branch merged
  before it, already contains is left out.

The fork never merges its pull requests, since `develop` only mirrors upstream. An open pull request is what puts a
change into `staging/web`, and closing it takes the change out at the next rebuild. Pull requests from other
repositories never enter `staging/web`.

The `Web image` workflow builds every push to `staging/web`, and tags the commit it builds
`build/<yyyymmdd>-<12-character commit>` ("Source" above).

## Contributing upstream

This is undecided. Upstream takes contributions only under Element's Contributor License Agreement (CLA), and the owner
has not decided whether to sign it. Until then nothing is sent upstream, but every `feat/*` and `fix/*` branch is
written as if it would be. If the answer is yes, the pull request to `element-hq/element-web` is opened from the same
branch, with a description a person writes, and for a feature an upstream issue that accepts it (`CONTRIBUTING.md`);
nothing else changes. Once upstream has merged the change, it arrives through `develop`, and the fork's pull request
is closed.

## Rebuilding staging/web

`scripts/rebuild-staging.sh` rebuilds `staging/web` in a clone of the fork without touching any checkout. It fetches
`origin`, asks `gh` for the open pull requests, and merges `origin/develop`, `origin/config/web-image` and the pull
requests' branches with signed merge commits. With `--offline` it merges the local `develop`, `config/web-image` and
every local `feat/*` and `fix/*` branch instead. It stops at the first conflict and names the branch, leaving
`staging/web` as it was, and keeps `staging/web` when it already joins exactly these commits in clean merges. It ends
with a summary and the command that publishes the result:

```sh
scripts/rebuild-staging.sh
git push --force-with-lease=refs/heads/staging/web:<the commit it replaces> origin staging/web
```

The `Sync upstream` workflow does all of this every day at 03:17 UTC, and whenever it is started by hand. It
fast-forwards `develop` to upstream's and pushes it, rebuilds `staging/web` with the script and pushes it with
`--force-with-lease`, which starts the `Web image` workflow. Its merge commits come from `github-actions[bot]` and are
not signed. On a conflict it opens the issue "staging/web: conflict with upstream on <branch>", or updates the one
that is open, and stops; `staging/web` and the image stay as they were. Rebase the branch it names onto `develop`, or
onto `config/web-image` if it is built on that, resolve the conflict, amend the commit, push it with
`--force-with-lease` and start the workflow again. The next run without a conflict closes the issue. When the
conflict is with another pull request rather than with `develop`, the two changes overlap, and one of them has to
change.

Before its first run:

- Open the pull requests for every branch `staging/web` should carry. The workflow merges only branches with an open
  pull request, so a branch without one drops out of `staging/web` and the image.
- Make `config/web-image` the repository's default branch. GitHub runs scheduled workflows, and offers workflows to
  start by hand, only from the default branch, and `develop` cannot carry this one. Upstream's scheduled, issue and
  `workflow_run` jobs then read this branch's guarded copies too.
- Add the secret `SYNC_TOKEN`: a fine-grained personal access token for this repository alone, with the repository
  permissions Contents and Workflows set to read and write. The workflow's own token is not enough. GitHub refuses
  its pushes when they change files in `.github/workflows`, which upstream's `develop` does on many days, and its
  pushes start no other workflow, so no image would be built. The workflow's own token only reads the pull requests
  and writes the issue (`issues: write`, `pull-requests: read`).
- Turn on Issues, which GitHub turns off in a new fork.

Pushing `develop` with that token starts upstream's own workflows for pushes to `develop`, in upstream's unguarded
copy: turn off the ones that publish, deploy or notify in the repository's Actions settings. Workflows upstream adds
later reach `staging/web` with the next rebuild, and `config/web-image` when it is rebased, without a guard; guard the
new ones that publish, deploy or notify on `config/web-image` (`CLAUDE.md`, "Upstream's workflows").

# Supported Environments

Element has several tiers of support for different environments:

- Supported
    - Definition:
        - Issues **actively triaged**, regressions **block** the release
    - Last 2 major versions of Chrome, Firefox, and Edge on desktop OSes
    - Last 2 versions of Safari
    - Latest release of official Element Desktop app on desktop OSes
    - Desktop OSes means macOS, Windows, and Linux versions for desktop devices
      that are actively supported by the OS vendor and receive security updates
- Best effort
    - Definition:
        - Issues **accepted**, regressions **do not block** the release
        - The wider Element Products (including Element Call and the Enterprise Server Suite) do still not officially support these browsers.
        - The element web project and its contributors should keep the client functioning and gracefully degrade where other sibling features (E.g. Element Call) may not function.
    - Last major release of Firefox ESR and Chrome/Edge Extended Stable
- Community Supported
    - Definition:
        - Issues **accepted**, regressions **do not block** the release
        - Community contributions are welcome to support these issues
    - Mobile web for current stable version of Chrome, Firefox, and Safari on Android, iOS, and iPadOS
- Not supported
    - Definition: Issues only affecting unsupported environments are **closed**
    - Everything else

The period of support for these tiers should last until the releases specified above, plus 1 app release cycle(2 weeks). In the case of Firefox ESR this is extended further to allow it land in Debian Stable.

For accessing Element on an Android or iOS device, we currently recommend the
native apps [element-x-android](https://github.com/element-hq/element-x-android)
and [element-x-ios](https://github.com/element-hq/element-x-ios).

# Getting Started

The easiest way to test Element is to just use the hosted copy at <https://app.element.io>.
The `develop` branch is continuously deployed to <https://develop.element.io>
for those who like living dangerously.

To host your own instance of Element see [Installing Element Web](docs/install.md).

To install Element as a desktop application, see [Running as a desktop app](#running-as-a-desktop-app) below.

---

# Monorepo

This repository is a monorepo hosting Element Web and other related projects in various subdirectories.
You can read more about the structure [here](docs/monorepo.md).

# Element Web

To learn more about Element Web [click here](apps/web/README.md)

# Running as a Desktop app

Element can also be run as a desktop app, wrapped in Electron. You can download a
pre-built version from <https://element.io/get-started> or, if you prefer,
build it yourself.

To build it yourself, follow the instructions at <https://github.com/element-hq/element-web/tree/develop/apps/desktop>.

Many thanks to @aviraldg for the initial work on the Electron integration.

The [configuration docs](docs/config.md#desktop-app-configuration) show how to override the desktop app's default settings if desired.

# Development

Please read through the following:

1. [Developer guide](./developer_guide.md)
2. [Code style](./code_style.md)
3. [Contribution guide](./CONTRIBUTING.md)

# Translations

To add a new translation, head to the [translating doc](docs/translating.md).

For a developer guide, see the [translating dev doc](docs/translating-dev.md).

# Triaging issues

Issues are triaged by community members and the Web App Team, following the [triage process](https://github.com/element-hq/element-meta/wiki/Triage-process).

We use [issue labels](https://github.com/element-hq/element-meta/wiki/Issue-labelling) to sort all incoming issues.

## Copyright & License

Copyright (c) 2014-2017 OpenMarket Ltd
Copyright (c) 2017 Vector Creations Ltd
Copyright (c) 2017-2025 New Vector Ltd

This software is multi licensed by New Vector Ltd (Element). It can be used either:

(1) for free under the terms of the GNU Affero General Public License (as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version); OR

(2) for free under the terms of the GNU General Public License (as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version); OR

(3) under the terms of a paid-for Element Commercial License agreement between you and Element (the terms of which may vary depending on what you and Element have agreed to).
Unless required by applicable law or agreed to in writing, software distributed under the Licenses is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the Licenses for the specific language governing permissions and limitations under the Licenses.

Please contact [licensing@element.io](mailto:licensing@element.io) to purchase
an Element commercial license for this software.
