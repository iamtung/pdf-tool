import sys

import pytest

from pdftool import cli, instance, server


def test_missing_ui_build_exits_with_hint(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(server, "STATIC", tmp_path / "static-empty")
    monkeypatch.setattr(sys, "argv", ["pdftool", "--no-browser"])

    def no_lock():
        raise AssertionError("must exit before acquiring the instance lock")

    monkeypatch.setattr(instance, "acquire", no_lock)
    with pytest.raises(SystemExit) as e:
        cli.main()
    assert e.value.code == 1
    err = capsys.readouterr().err
    assert "cd web && npm install && npm run build" in err
    assert "Chưa build giao diện" in err


def test_dev_mode_skips_ui_check(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "STATIC", tmp_path / "static-empty")
    monkeypatch.setattr(sys, "argv", ["pdftool", "--dev"])
    monkeypatch.delenv("PDFTOOL_DEV", raising=False)

    class Reached(Exception):
        pass

    def stop():
        raise Reached

    monkeypatch.setattr(instance, "acquire", stop)
    with pytest.raises(Reached):
        cli.main()
