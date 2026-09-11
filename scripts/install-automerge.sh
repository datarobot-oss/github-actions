#!/usr/bin/env bash
#
# install-automerge.sh — enrol a repository in the automerge workflow.
#
# Automerge needs five things lined up, and the two that are easiest to get
# wrong fail in opposite ways: a missing ruleset bypass fails loudly on every
# PR, and a missing `automerge` label fails silently forever. This script
# checks all of them, fixes the ones that are safe to fix, and tells you
# precisely what is left.
#
# It is READ-ONLY unless you pass --apply.
#
# WHAT IT CANNOT DO: install the GitHub App on the repository. The API for that
# (`PUT /user/installations/{id}/repositories/{id}`) needs a user-to-server
# token from an OAuth flow, which the `gh` CLI does not issue. That step stays a
# click in the browser. The script DOES detect whether it has happened, by
# authenticating as the App itself with the private key, so you will never be
# left guessing.
#
# WHAT IT DELIBERATELY WILL NOT DO: split your rulesets. Moving the
# `pull_request` rule between rulesets is surgery on branch protection, and
# getting it wrong is the one way to make automerge genuinely unsafe. It is
# reported with exact instructions instead.
#
# Usage:
#   scripts/install-automerge.sh --repo owner/name [--pem key.pem] [--apply]
#
set -euo pipefail

APP_ID_DEFAULT='4912188'
SECRET_NAME_DEFAULT='DR_AUTO_MERGE_PRIVATE_KEY'

REPO=''
PEM=''
APP_ID="$APP_ID_DEFAULT"
SECRET_NAME="$SECRET_NAME_DEFAULT"
APPLY='false'

# Problems that block automerge entirely, and warnings that do not.
FAILURES=0
WARNINGS=0
TODO=()

usage() {
  cat <<'USAGE'
Enrol a repository in the automerge workflow.

  --repo owner/name     Repository to enrol. Required.
  --pem PATH            The App's private key. Needed to detect whether the App
                        is installed, and to set the secret with --apply.
  --app-id ID           App id. Default: 4912188 (dr-auto-merge).
  --secret-name NAME    Actions secret holding the key.
                        Default: DR_AUTO_MERGE_PRIVATE_KEY.
  --apply               Make the safe changes: create the `automerge` label,
                        set the secret, add the App to the review ruleset's
                        bypass list. Without it, nothing is written.
  -h, --help            This text.

Exit status is non-zero if anything still blocks automerge.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)        REPO="${2:-}"; shift 2 ;;
    --pem)         PEM="${2:-}"; shift 2 ;;
    --app-id)      APP_ID="${2:-}"; shift 2 ;;
    --secret-name) SECRET_NAME="${2:-}"; shift 2 ;;
    --apply)       APPLY='true'; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$REPO" ]; then
  echo "--repo owner/name is required." >&2
  usage >&2
  exit 2
fi
case "$REPO" in
  */*) ;;
  *) echo "--repo must be owner/name, got '$REPO'." >&2; exit 2 ;;
esac

ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
did()  { printf '  \033[36mdone\033[0m  %s\n' "$1"; }
head2() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# App authentication
#
# A JWT signed with the App's private key authenticates AS THE APP, which is the
# only way to ask "am I installed on this repo?" without an OAuth flow. base64url
# is plain base64 with +/ swapped for -_ and the padding stripped.
# ---------------------------------------------------------------------------
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

app_jwt() {
  local now header payload signing_input signature
  now="$(date +%s)"
  # `iat` is backdated 60s because GitHub rejects a token whose issue time is in
  # the future, and a small clock skew between here and GitHub is normal.
  header='{"alg":"RS256","typ":"JWT"}'
  payload="$(printf '{"iat":%s,"exp":%s,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$APP_ID")"
  signing_input="$(printf '%s' "$header" | b64url).$(printf '%s' "$payload" | b64url)"
  signature="$(printf '%s' "$signing_input" \
    | openssl dgst -sha256 -sign "$PEM" -binary \
    | b64url)"
  printf '%s.%s' "$signing_input" "$signature"
}

# ---------------------------------------------------------------------------
head2 "Prerequisites"
# ---------------------------------------------------------------------------
for tool in gh jq openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    bad "$tool is not on PATH."
  fi
done
[ "$FAILURES" -eq 0 ] || { echo; echo "Install the missing tools and re-run." >&2; exit 1; }

if gh auth status >/dev/null 2>&1; then
  ok "gh is authenticated."
else
  bad "gh is not authenticated. Run: gh auth login"
  exit 1
fi

# ---------------------------------------------------------------------------
head2 "Repository: $REPO"
# ---------------------------------------------------------------------------
REPO_JSON="$(gh api "repos/$REPO" 2>/dev/null || echo '')"
if [ -z "$REPO_JSON" ]; then
  bad "Cannot read $REPO. Check the name and your access."
  exit 1
fi
DEFAULT_BRANCH="$(printf '%s' "$REPO_JSON" | jq -r '.default_branch')"
ok "Default branch is '$DEFAULT_BRANCH'."

if [ "$(printf '%s' "$REPO_JSON" | jq -r '.permissions.admin // false')" = 'true' ]; then
  ok "You have admin on this repository."
else
  # Everything this script writes needs admin. Without it the checks still run,
  # so a non-admin can produce the report and hand it to someone who can act.
  warn "You are not an admin here; --apply cannot write secrets or rulesets."
fi

# ---------------------------------------------------------------------------
head2 "GitHub App (id $APP_ID)"
# ---------------------------------------------------------------------------
INSTALL_PERMS=''
if [ -z "$PEM" ]; then
  warn "No --pem given, so the App installation cannot be verified."
  TODO+=("Re-run with --pem to confirm the App is installed on $REPO.")
elif [ ! -f "$PEM" ]; then
  bad "No private key at '$PEM'."
else
  JWT="$(app_jwt)"
  INSTALL_JSON="$(gh api "repos/$REPO/installation" -H "Authorization: Bearer $JWT" 2>/dev/null || echo '')"
  if [ -z "$INSTALL_JSON" ] || [ "$(printf '%s' "$INSTALL_JSON" | jq -r '.id // empty')" = '' ]; then
    bad "The App is NOT installed on $REPO."
    TODO+=("Install the App on $REPO: https://github.com/settings/apps/dr-auto-merge/installations")
  else
    ok "The App is installed (installation $(printf '%s' "$INSTALL_JSON" | jq -r '.id'))."
    INSTALL_PERMS="$(printf '%s' "$INSTALL_JSON" | jq -c '.permissions // {}')"
    # A permission granted at the wrong level fails only at the moment of the
    # merge, which is the worst time to find out.
    for want in 'contents=write' 'pull_requests=write' 'workflows=write' 'checks=read' 'statuses=read'; do
      key="${want%%=*}"; level="${want##*=}"
      got="$(printf '%s' "$INSTALL_PERMS" | jq -r --arg k "$key" '.[$k] // "none"')"
      if [ "$got" = 'write' ] || { [ "$level" = 'read' ] && [ "$got" = 'read' ]; }; then
        ok "permission $key=$got"
      else
        bad "permission $key is '$got', needs '$level'."
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
head2 "Secret: $SECRET_NAME"
# ---------------------------------------------------------------------------
# `|| true`: a repo with no secrets at all still 200s with an empty list, but a
# permissions problem 404s, and that must not abort the whole script.
SECRETS_JSON="$(gh api "repos/$REPO/actions/secrets" 2>/dev/null || echo '{}')"
if printf '%s' "$SECRETS_JSON" | jq -e --arg n "$SECRET_NAME" '.secrets // [] | any(.name == $n)' >/dev/null 2>&1; then
  ok "$SECRET_NAME is readable by this repository."
elif [ "$APPLY" = 'true' ] && [ -n "$PEM" ] && [ -f "$PEM" ]; then
  gh secret set "$SECRET_NAME" --repo "$REPO" < "$PEM"
  did "Set $SECRET_NAME from $PEM."
else
  bad "$SECRET_NAME is not available to this repository."
  TODO+=("Set the secret: gh secret set $SECRET_NAME --repo $REPO < your-key.pem")
fi

# ---------------------------------------------------------------------------
head2 "Rulesets on '$DEFAULT_BRANCH'"
# ---------------------------------------------------------------------------
RULESETS="$(gh api "repos/$REPO/rulesets" 2>/dev/null || echo '[]')"

CHECKS_RULESETS=''   # ids carrying required_status_checks
REVIEW_RULESETS=''   # ids carrying pull_request
for id in $(printf '%s' "$RULESETS" | jq -r '.[].id'); do
  detail="$(gh api "repos/$REPO/rulesets/$id" 2>/dev/null || echo '{}')"
  if printf '%s' "$detail" | jq -e '.rules // [] | any(.type == "required_status_checks")' >/dev/null 2>&1; then
    CHECKS_RULESETS="$CHECKS_RULESETS $id"
  fi
  if printf '%s' "$detail" | jq -e '.rules // [] | any(.type == "pull_request")' >/dev/null 2>&1; then
    REVIEW_RULESETS="$REVIEW_RULESETS $id"
  fi
done

review_count="$(printf '%s' "$REVIEW_RULESETS" | wc -w | tr -d ' ')"
checks_count="$(printf '%s' "$CHECKS_RULESETS" | wc -w | tr -d ' ')"

if [ "$checks_count" -eq 0 ]; then
  bad "No ruleset requires any status check. Automerge would verify nothing."
  TODO+=("Add a ruleset with required_status_checks and an EMPTY bypass list.")
fi

# THE INVARIANT. Ruleset bypass applies to a whole ruleset, so an actor
# bypassing a ruleset that also carries required_status_checks can merge a RED
# PR. This is the single catastrophic misconfiguration, so it is checked
# unconditionally and the script refuses to write a bypass that would create it.
UNSAFE_RULESETS=''
for id in $CHECKS_RULESETS; do
  for rid in $REVIEW_RULESETS; do
    [ "$id" = "$rid" ] && UNSAFE_RULESETS="$UNSAFE_RULESETS $id"
  done
done

if [ -n "$UNSAFE_RULESETS" ]; then
  bad "Ruleset(s)$UNSAFE_RULESETS carry BOTH required_status_checks and pull_request."
  echo "        Bypass applies to a whole ruleset, so bypassing that one would let the"
  echo "        bot merge a failing PR. Split them before enrolling this repo:"
  echo "          - ruleset A: deletion, non_fast_forward, required_status_checks  (bypass EMPTY)"
  echo "          - ruleset B: pull_request only                                   (bypass the App)"
  echo "        The pull_request rule must end up in exactly ONE ruleset. Left in both,"
  echo "        the bypass is silently defeated."
  TODO+=("Split the rulesets on $REPO as described above, then re-run.")
elif [ "$review_count" -eq 0 ]; then
  warn "No ruleset requires review, so no bypass is needed. Automerge will work,"
  echo "        but so would anyone else merging unreviewed."
else
  ok "Review and required-check rules live in separate rulesets."
  for id in $REVIEW_RULESETS; do
    detail="$(gh api "repos/$REPO/rulesets/$id" 2>/dev/null || echo '{}')"
    name="$(printf '%s' "$detail" | jq -r '.name')"
    if printf '%s' "$detail" | jq -e --argjson a "$APP_ID" \
        '.bypass_actors // [] | any(.actor_id == $a and .actor_type == "Integration")' >/dev/null 2>&1; then
      ok "Ruleset '$name' already bypasses the App."
    elif [ "$APPLY" = 'true' ]; then
      # Additive and reversible: append one bypass entry, touching nothing else.
      # Re-read afterwards rather than trusting the write, because a ruleset edit
      # that appears to apply and does not is a known failure mode.
      updated="$(printf '%s' "$detail" | jq --argjson a "$APP_ID" \
        '{bypass_actors: ((.bypass_actors // []) + [{actor_id: $a, actor_type: "Integration", bypass_mode: "always"}])}')"
      printf '%s' "$updated" | gh api --method PUT "repos/$REPO/rulesets/$id" --input - >/dev/null
      verify="$(gh api "repos/$REPO/rulesets/$id" 2>/dev/null || echo '{}')"
      if printf '%s' "$verify" | jq -e --argjson a "$APP_ID" \
          '.bypass_actors // [] | any(.actor_id == $a)' >/dev/null 2>&1; then
        did "Added the App to ruleset '$name' bypass list."
      else
        bad "Wrote the bypass to '$name' but re-reading shows it absent. Check by API, not the UI."
      fi
    else
      bad "Ruleset '$name' does not bypass the App; the bot could approve but never merge."
      TODO+=("Add bypass_actors {actor_id: $APP_ID, actor_type: Integration} to ruleset '$name'.")
    fi
  done
fi

# ---------------------------------------------------------------------------
head2 "Required status checks"
# ---------------------------------------------------------------------------
BRANCH_RULES="$(gh api "repos/$REPO/rules/branches/$DEFAULT_BRANCH" 2>/dev/null || echo '[]')"
CONTEXTS="$(printf '%s' "$BRANCH_RULES" \
  | jq -r '[.[] | select(.type == "required_status_checks")
            | .parameters.required_status_checks[].context] | .[]' 2>/dev/null || true)"
if [ -z "$CONTEXTS" ]; then
  warn "No required contexts on '$DEFAULT_BRANCH'. expected_checks must carry the load."
else
  ok "Required contexts (added to expected_checks automatically):"
  printf '%s\n' "$CONTEXTS" | sed 's/^/          /'
fi

# ---------------------------------------------------------------------------
head2 "Label"
# ---------------------------------------------------------------------------
# Dependabot silently drops a `labels:` entry naming a label that does not
# exist. No warning, no label, and the workflow then runs green forever finding
# no candidates. Invisible from both ends, so it is checked explicitly.
if gh api "repos/$REPO/labels/automerge" >/dev/null 2>&1; then
  ok "The 'automerge' label exists."
elif [ "$APPLY" = 'true' ]; then
  gh api --method POST "repos/$REPO/labels" \
    -f name=automerge -f color=0e8a16 \
    -f description='Opts a bot-authored PR into unattended approve-and-merge once every expected check is green.' \
    >/dev/null
  did "Created the 'automerge' label."
else
  bad "The 'automerge' label does not exist, so no PR will ever be a candidate."
  TODO+=("Create the label, or run the ensure-labels workflow on $REPO.")
fi

# ---------------------------------------------------------------------------
head2 "Files on '$DEFAULT_BRANCH'"
# ---------------------------------------------------------------------------
# Checked on the default branch, not the working tree: that is where the
# workflow reads its policy from, and an uncommitted file changes nothing.
for path in '.github/automerge.yaml' '.github/workflows/automerge.yaml'; do
  if gh api "repos/$REPO/contents/$path?ref=$DEFAULT_BRANCH" >/dev/null 2>&1; then
    ok "$path is on $DEFAULT_BRANCH."
  else
    bad "$path is missing from $DEFAULT_BRANCH."
    TODO+=("Add $path (see examples/ in datarobot-oss/github-actions) and merge it.")
  fi
done

# ---------------------------------------------------------------------------
head2 "Result"
# ---------------------------------------------------------------------------
if [ "${#TODO[@]}" -gt 0 ]; then
  echo "Remaining steps:"
  i=1
  for item in "${TODO[@]}"; do
    printf '  %d. %s\n' "$i" "$item"
    i=$((i + 1))
  done
  echo
fi

if [ "$FAILURES" -gt 0 ]; then
  printf '\033[31m%s blocking problem(s)\033[0m, %s warning(s). Automerge will NOT run on %s yet.\n' \
    "$FAILURES" "$WARNINGS" "$REPO"
  exit 1
fi

printf '\033[32mReady.\033[0m %s warning(s). Start the caller in report mode and watch it for a week.\n' "$WARNINGS"
