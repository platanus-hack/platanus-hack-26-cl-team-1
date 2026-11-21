import numpy as np
import torch
from app.controller.learned import MISTAKE_CLASSES, GruModel, feature_size
from app.controller.rules import RulesController
from contracts import MistakeKind, Split
from symsim import NOISE_LEVELS, generate_run
from symsim.cli import load_task

from ctrl import TASKS_DIR
from ctrl.data import encode, true_done_after
from ctrl.evaluate import Metrics, eval_runs, score_run
from ctrl.model import ControllerNet

TASK, ONTOLOGY = load_task(TASKS_DIR / "hand_hygiene" / "hand_hygiene_basic.json")


def test_numpy_forward_matches_torch():
    torch.manual_seed(0)
    net = ControllerNet(feature_size(TASK), len(TASK.steps), len(MISTAKE_CLASSES), hidden=16)
    x, _, _ = encode(TASK, generate_run(TASK, 0, 1, NOISE_LEVELS["medium"], ONTOLOGY, "medium"))
    with torch.no_grad():
        done_logits, mistake_logits = net(torch.from_numpy(x)[None])
    model = GruModel({k: v.numpy() for k, v in net.state_dict().items()})
    h = np.zeros(16)
    for t in range(len(x)):
        h, p_done, p_mistake = model.step(x[t], h)
        np.testing.assert_allclose(p_done, torch.sigmoid(done_logits[0, t]).numpy(), atol=1e-5)
        np.testing.assert_allclose(p_mistake, torch.softmax(mistake_logits[0, t], -1).numpy(), atol=1e-5)


def test_encode_shapes_and_labels():
    run = generate_run(TASK, 0, 2, NOISE_LEVELS["low"], ONTOLOGY, "low")
    x, y, m = encode(TASK, run)
    assert x.shape == (len(run.events), feature_size(TASK))
    assert y.shape == (len(run.events), len(TASK.steps))
    assert (np.diff(y, axis=0) >= 0).all()  # done never goes back
    assert [MISTAKE_CLASSES[i] for i in m] == [e.mistake_kind for e in run.events]


def test_true_done_reaches_all_steps_on_completed_runs():
    for i in range(30):
        run = generate_run(TASK, 0, i, NOISE_LEVELS["clean"], ONTOLOGY, "clean")
        assert (len(true_done_after(TASK, run)[-1]) == len(TASK.steps)) == run.completed


def test_eval_split_is_disjoint_from_train():
    test = eval_runs(TASK, ONTOLOGY, "clean", 0, 300)
    assert test and all(r.split is Split.TEST for r in test)


def test_rules_on_clean_runs_track_perfectly_and_never_flag_repeated():
    m = Metrics()
    for run in eval_runs(TASK, ONTOLOGY, "clean", 0, 300):
        score_run(RulesController(), TASK, run, m)
    row = m.row()
    assert row["step_acc"] == 1.0 and row["fa_per_run"] == 0.0
    assert m.detected[MistakeKind.REPEATED] == 0  # by design: rules stay quiet on a repeated report
