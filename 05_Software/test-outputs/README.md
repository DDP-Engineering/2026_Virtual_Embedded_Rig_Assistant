# Test outputs

Evidence that functional tests and work packages leave behind includes screenshots, receipts,
original logs and platform probes. Use one dated folder per ticket or topic for manually named
evidence, such as `YYYY-MM-DD-<ticket>-<topic>/`. Local test helpers, such as the Python environment
for plugin tests (`plugin-test-python/`), also live here. A dated index in the local validation
archive, when present, maps the original paths recorded in task journals to their current locations.

Everything here except this README is ignored by Git. Evidence that must be kept is added
deliberately with `git add -f`. Measurements and scores of the [evaluators](../evaluators/README.md)
do not belong here; they go to [`../evaluation-outputs/`](../evaluation-outputs/README.md).
