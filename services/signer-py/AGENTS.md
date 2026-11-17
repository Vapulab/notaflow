# Signer Py: AI Context

The Python `Signer` (signxml and lxml). It is plan B: the Stage 0 spike compares it with the Node signer against the national test environment.

## Quick Reference

- Entry points: `notaflow_signer.sign.sign_xml`, `verify_xml`, and the CLI `python -m notaflow_signer.cli sign|verify` (JSON on stdin and stdout, UTF-8)
- Tests: `pip install -e "services/signer-py[test]"`, then `pytest services/signer-py`

## Documentation Index

- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - the Signer port

## Key Rules

1. Promote this to a FastAPI sidecar only if the Stage 0 decision picks Python.
2. `_NfseSigner` allows SHA1 on purpose: the national NFS-e accepts RSA-SHA1.
3. Keep signxml at 5.3.0 or later. Older versions cannot verify an inclusive-C14N signature whose `Signature` redefines the default namespace, so they reject valid Node SHA1 signatures.
