# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single, standalone Python package: **manipulation-score**, a library + CLI that computes the Beneish M-Score. There are no long-running services, servers, databases, ports, or external dependencies.

### Environment
- Python 3.12 is used (project requires >=3.10). Dependencies are installed into a local virtualenv at `.venv/` (git-ignored). The startup update script creates/refreshes `.venv` and runs `pip install -e ".[dev]"`, so a working env is already in place for future agents.
- `python3-venv` (system package) is required to create the virtualenv; it is baked into the environment snapshot, so it is intentionally NOT in the update script.
- Activate with `source .venv/bin/activate`, or call tools directly via `.venv/bin/<tool>` (e.g. `.venv/bin/pytest`).

### Test / run
- Run tests: `.venv/bin/pytest` (config: `[tool.pytest.ini_options]` in `pyproject.toml`, `testpaths=["tests"]`).
- CLI (all eight ratio flags are required floats): `.venv/bin/manipulation-score --dsri 1.2 --gmi 1.1 --aqi 1.0 --sgi 1.3 --depi 0.9 --sgai 1.05 --lvgi 1.0 --tata 0.08`. See `README.md` for the library API example.
- Lint: no linter/type-checker is configured (no ruff/flake8/mypy in deps despite `.gitignore` cache entries), so there is no lint step to run.
