"""The shipped sample projects must conform to the published project JSON Schema."""
import glob
import json
import os

import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def test_examples_validate_against_schema():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.load(open(os.path.join(ROOT, "shared/schemas/project.schema.json"), encoding="utf-8"))
    files = sorted(glob.glob(os.path.join(ROOT, "examples/*.ntcs.json")))
    assert files, "examples/ is empty (run `npm run gen:docs` in frontend/)"
    for f in files:
        jsonschema.validate(json.load(open(f, encoding="utf-8")), schema)


def test_input_command_schema_is_valid_json_schema():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.load(open(os.path.join(ROOT, "shared/commands/input-commands.schema.json"), encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    v = jsonschema.Draft202012Validator(schema)
    assert v.is_valid({"type": "pointer", "phase": "down", "x": 0.2, "y": 0.4})
    assert not v.is_valid({"type": "pointer", "phase": "down", "x": 1.5, "y": 0.4})
