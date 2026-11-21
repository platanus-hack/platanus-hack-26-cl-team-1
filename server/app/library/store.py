"""Task library: loads and validates every task under tasks/<domain>/ at startup (owner: Alonso).

Layout: tasks/<domain>/ontology.json plus one JSON file per task. An invalid file stops the server:
a broken task must never reach a session.

Tasks are listed sorted by task id, never by folder: the web app opens on the first one, so adding a
domain must not change that default.
"""

from __future__ import annotations

from pathlib import Path

from contracts import Ontology, Task, TaskSummary


def check_objects_cover_actions(task: Task, ontology: Ontology) -> None:
    """Raise ValueError unless the task lists every object its actions use (prompts and the simulator
    describe the scene from `task.objects`)."""
    listed = set(task.objects)
    for action_id in task.actions:
        action = ontology.action(action_id)
        missing = [o for o in (action.object, action.target) if o is not None and o not in listed]
        if missing:
            raise ValueError(f"task {task.id!r}: action {action_id!r} uses objects {missing} it doesn't list")


class TaskLibrary:
    def __init__(self, tasks: dict[str, Task]) -> None:
        self._tasks = tasks

    @classmethod
    def load(cls, root: Path) -> TaskLibrary:
        tasks: dict[str, Task] = {}
        for domain_dir in sorted(p for p in root.iterdir() if p.is_dir()):
            ontology = Ontology.model_validate_json((domain_dir / "ontology.json").read_text())
            for path in sorted(domain_dir.glob("*.json")):
                if path.name == "ontology.json":
                    continue
                task = Task.model_validate_json(path.read_text())
                task.check_against(ontology)
                check_objects_cover_actions(task, ontology)
                if task.id in tasks:
                    raise ValueError(f"duplicate task id {task.id!r} in {path}")
                tasks[task.id] = task
        if not tasks:
            raise ValueError(f"no tasks found under {root}")
        return cls(dict(sorted(tasks.items())))

    def get(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    def summaries(self) -> list[TaskSummary]:
        return [
            TaskSummary(id=t.id, version=t.version, title_es=t.title_es, domain=t.domain, steps=len(t.steps))
            for t in self._tasks.values()
        ]
