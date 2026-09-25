#!/usr/bin/env bash
# Registers this Mac as the QA Factory's self-hosted GitHub Actions runner.
# Run it yourself; it downloads GitHub's official runner and starts it as a
# user service. It only picks up jobs labelled qa-factory from this repository.
set -euo pipefail
REPO="tanmaysaxena112-ux/qa-factory"
DIR="$HOME/actions-runner-qa-factory"
VERSION="$(gh api repos/actions/runner/releases/latest --jq .tag_name | sed 's/^v//')"
mkdir -p "$DIR" && cd "$DIR"
curl -fsSLo runner.tar.gz "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-osx-arm64-${VERSION}.tar.gz"
tar xzf runner.tar.gz && rm runner.tar.gz
TOKEN="$(gh api -X POST "repos/${REPO}/actions/runners/registration-token" --jq .token)"
./config.sh --unattended --url "https://github.com/${REPO}" --token "$TOKEN" --name "$(hostname -s)-qa-factory" --labels qa-factory --replace
./svc.sh install && ./svc.sh start
echo "Runner registered and started. Remove with: cd $DIR && ./svc.sh uninstall && ./config.sh remove"
