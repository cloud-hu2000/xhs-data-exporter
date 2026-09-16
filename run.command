#!/bin/bash

cd "$(dirname "$0")" || exit 1

node src/cli.js "$@"
EXIT_CODE=$?

if [ "$#" -gt 0 ]; then
  exit "$EXIT_CODE"
fi

echo
read -r -n 1 -s -p "Press any key to continue..."
echo
exit "$EXIT_CODE"
