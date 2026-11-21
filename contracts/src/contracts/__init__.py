"""Shared contracts. Change them only with a decision entry, and update every side in the same PR.

Spec: docs/CONTRACTS.md. JSON Schemas (generated): contracts/schemas/.
"""

from .automaton import Outcome, TaskAutomaton, Transition
from .common import PROTOCOL_VERSION, MistakeKind, Source, StepStatus
from .dataset import ClipRecord, ClipSource, Split, Trajectory, TrajectoryEvent
from .decision import Decision, Event, Priority, SayRequest
from .ontology import ActionDef, ObjectDef, Ontology
from .perception import InvalidVlmOutput, Observation, Quality, VlmOutput, parse_vlm_output
from .task import MistakeDef, Step, Task, TaskSummary

__all__ = [
    "PROTOCOL_VERSION",
    "ActionDef",
    "ClipRecord",
    "ClipSource",
    "Decision",
    "Event",
    "InvalidVlmOutput",
    "MistakeDef",
    "MistakeKind",
    "ObjectDef",
    "Observation",
    "Ontology",
    "Outcome",
    "Priority",
    "Quality",
    "SayRequest",
    "Source",
    "Split",
    "Step",
    "StepStatus",
    "Task",
    "TaskAutomaton",
    "TaskSummary",
    "Trajectory",
    "TrajectoryEvent",
    "Transition",
    "VlmOutput",
    "parse_vlm_output",
]
