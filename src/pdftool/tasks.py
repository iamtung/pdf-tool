"""Worker entry points. Each runs in its own process: fn(args, progress) -> dict."""
from pathlib import Path

from pdftool import analysis_cache, profile_cache
from pdftool.core import analyzer
from pdftool.core.export import ExportOptions, run_estimate, run_export
from pdftool.core.plan import Plan
from pdftool.core.profile import build_profile


def analysis(args: dict, progress) -> dict:
    report = analyzer.analyze(Path(args["path"]), args.get("password"), progress)
    analysis_cache.save(args["fingerprint"], report)
    return report


def profile(args: dict, progress) -> dict:
    path = Path(args["path"])
    password = args.get("password")
    report = analysis_cache.load(args["fingerprint"])
    if report is None:
        report = analyzer.analyze(path, password, progress)
        analysis_cache.save(args["fingerprint"], report)
    built = build_profile(path, password, report, Path(args["workdir"]), progress)
    built["fingerprint"] = args["fingerprint"]  # the cache is keyed by the registry fingerprint
    profile_cache.save(args["fingerprint"], built)
    return built


def estimate(args: dict, progress) -> dict:
    return run_estimate(
        Plan.model_validate(args["plan"]), args["sources"], args.get("pageIds"), args.get("level"),
        Path(args["workdir"]), progress,
    )


def export(args: dict, progress) -> dict:
    opts = ExportOptions(Path(args["destDir"]), args["baseName"], args.get("split"))
    return run_export(Plan.model_validate(args["plan"]), args["sources"], opts, Path(args["workdir"]), progress)


TASKS = {"analysis": analysis, "estimate": estimate, "export": export, "profile": profile}
