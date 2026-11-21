"""The PyTorch model. Parameter names and shapes are what `app.controller.learned.GruModel` reads."""

from __future__ import annotations

import torch
from torch import nn


class ControllerNet(nn.Module):
    def __init__(self, n_features: int, n_steps: int, n_mistakes: int, hidden: int = 64) -> None:
        super().__init__()
        self.embed = nn.Linear(n_features, hidden)
        self.gru = nn.GRU(hidden, hidden, batch_first=True)
        self.done = nn.Linear(hidden, n_steps)
        self.mistake = nn.Linear(hidden, n_mistakes)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h, _ = self.gru(torch.tanh(self.embed(x)))
        return self.done(h), self.mistake(h)
