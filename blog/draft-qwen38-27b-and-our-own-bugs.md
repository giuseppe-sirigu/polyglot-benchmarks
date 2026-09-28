---
title: "We tested the hyped model - and found two bugs in our own code along the way"
description: Testing tool-call reliability on a current-generation model (Qwen3.8-27B) - a genuinely different result than anything tested before, and two real bugs it surfaced in Polyglot itself.
date: 2026-09-26
---

## Why test this one specifically

Both [earlier posts](/blog/tool-call-reliability) tested `qwen2.5-coder`, a solid but no-longer-current
model family. A fair question followed: does this gap actually persist on a newer model, or is it
an artifact of testing something a bit dated? So we picked the model that's actually generating
buzz right now - Qwen3.8-27B, released last month - and ran the same six-task suite against it.

The honest answer up front: the result is genuinely different from every other model tested so
far, and getting to it meant finding and fixing two real bugs - including one in Polyglot's own
code.

## First pass: everyone does great

pi, goose, and opencode all hit **18/18** on the first clean run. That's not a typo, and it's not
a fluke - it held up on a second full rerun. This is the first time in this whole series that a
competitor has scored anything close to that, let alone three of them at once.

That's a real, honest result and it says something worth saying plainly: on a model with genuinely
excellent native tool-calling, native function-calling agents do just fine. The reliability gap
this whole series has been documenting isn't a permanent law - it's a property of *unreliable*
tool-calling specifically, and this model doesn't seem to have that problem.

## Then Polyglot scored 12/18 - and that was suspicious, not final

Polyglot's own score came back at 12/18 (well behind everyone else), and the transcripts didn't
show a reliability failure at all. Every miss was tagged `noRunaway` - a hard stop after too many
tool calls or too much wall-clock time - not a malformed call, not a narrated-as-text miss, not a
wrong answer. Something else was going on.

Digging into one transcript found it directly:

```
Let me verify nothing references `unused` first:

<tool_call name="grep">
{"pattern": "unused"}
</tool_result>
```

The model opens with `<tool_call>` and closes with `</tool_result>` - a mismatched tag. It does
this more than once, sometimes dropping the closing slash entirely. Polyglot's own parser was
only built to recognize `</tool_call>` (and the shorter `</tool>` some models default to) as a
valid close - `</tool_result>` wasn't one of them, so the parser kept buffering everything after
it as one unresolved block instead of recognizing the call had ended. The actual grep result that
came back was wrong (`No matches for /unused` on a file that plainly contains it) because of the
corrupted state that left behind.

This is a genuine bug in Polyglot, not a test-setup issue, and not something to bury: the fix is a
one-line regex change (`packages/core/src/tool-protocol/stream-parser.ts`) to also accept
`</tool_result>` as a mismatched-but-valid closer, same principle already applied to `</tool>`.
Two new tests added, all 454 existing tests still pass.

## The second thing: our own test budget didn't fit this model

Fixing the parser bug got five of six scenarios to pass cleanly. The sixth (`locate-and-fix`)
still tripped `noRunaway` - but this time at only 8 of a 40-call budget, nowhere near the cap.
The only other trigger for that check is a wall-clock timer, defaulted to 60 seconds - calibrated
against the smaller, faster models tested earlier in this series. A 27B model that's partially
CPU-offloaded on this hardware, and that reasons through a `<think>` block before every action,
genuinely needs more than 60 seconds some of the time - not because it's failing, but because
it's a bigger model doing more work per turn.

The transcript backs this up directly: the model had already correctly diagnosed the real bug
(a function called under the wrong name) and was mid-fix when the clock ran out. That's not a
reliability problem, that's an unfair test. Fixed by adding a per-model budget override to the
test harness rather than loosening the default for every model - the fast models stay held to a
tight bar, this one gets the time it actually needs.

## The real, final number

| Tool | Result |
|---|---|
| pi | 18/18 |
| goose | 18/18 |
| goose-toolshim | 16/18 |
| hermes | 17/18 |
| opencode | 18/18 |
| **Polyglot** | **18/18** |

Once both bugs were fixed, Polyglot lands right at parity with the field's best - not ahead, not
behind. On this specific model, the tool-call reliability gap this whole series exists to measure
has genuinely closed.

## What this does and doesn't mean

It means the frontier is real - a well-trained current-generation model can nail tool-calling
without any repair layer at all, and it's honest to say so plainly rather than quietly not
mentioning it. It doesn't mean the underlying problem this project exists for has gone away: this
is one model, from one lab, and *native* tool-calling on the
[most-run local coding models](/blog/tool-call-reliability) people actually deploy is still, as
tested, unreliable - including at 32B in the same family, where every other tool tested still made
zero tool calls on every single run. Polyglot's own repair-based approach scales well there too
(83%, up from 39% at 7B) - which is itself the point: the model's native tool-calling doesn't get
more reliable with size, but a repair layer built for exactly this failure does. A frontier model
getting native tool-calling right elsewhere doesn't retroactively fix every model below it, and
there's no guarantee the next release from any given lab keeps that property either.

If anything, this sharpens the actual point: reliability varies a lot between models, in ways that
aren't obvious until you actually run the numbers, and that's exactly why it needs to be measured
rather than assumed either way.

## Methodology note

Same six tasks, same scoring, same setup as the [original post](/blog/tool-call-reliability) - see
its methodology section for the full details. This model needed one addition: since the Ollama
GGUF conversion we used shipped a template with no tool-calling support at all, we built a custom
one from Qwen's own [officially published chat template](https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/tokenizer_config.json),
verified against a live tool call before trusting any result from it.

## Try it

`npm install -g @usepolyglot/cli`, point it at whatever's already running on your GPU.
[Get started →](/docs/start/install)
