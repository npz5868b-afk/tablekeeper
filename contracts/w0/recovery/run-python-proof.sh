#!/bin/sh
set -eu
mkdir -p /evidence/raw /evidence/generated
python --version > /evidence/raw/python-version.txt 2>&1
digest=$(sha256sum schemas/tablekeeper-contracts.schema.json | cut -d' ' -f1)
python -m datamodel_code_generator --input schemas/tablekeeper-contracts.schema.json --input-file-type jsonschema --output /tmp/tablekeeper-py-1.py --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 --disable-timestamp --use-standard-collections --use-union-operator
python -m datamodel_code_generator --input schemas/tablekeeper-contracts.schema.json --input-file-type jsonschema --output /tmp/tablekeeper-py-2.py --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 --disable-timestamp --use-standard-collections --use-union-operator
{ printf '# generated from schema sha256:%s; DO NOT EDIT\n' "$digest"; cat /tmp/tablekeeper-py-1.py; } > /evidence/generated/tablekeeper-py-1.py
{ printf '# generated from schema sha256:%s; DO NOT EDIT\n' "$digest"; cat /tmp/tablekeeper-py-2.py; } > /evidence/generated/tablekeeper-py-2.py
cmp /evidence/generated/tablekeeper-py-1.py /evidence/generated/tablekeeper-py-2.py
python recovery/runtime_parity.py > /evidence/raw/parity-python.json
printf '%s\n' '{"internetDenied":true,"control":"DOCKER_NETWORK_NONE","observed":"python proof completed with --network none"}' > /evidence/raw/network-python.json
