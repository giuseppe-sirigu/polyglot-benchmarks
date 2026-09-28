---
title: "Is it just a chat template? We checked."
description: A follow-up on open-weight tool-call reliability — ruling out chat template misconfiguration with a direct diff against the model's own official template, raw failing examples, a cross-backend vLLM test, and what actually does fix it.
date: 2026-09-25
---

## The pushback

Our [last post](/blog/tool-call-reliability) got a fair, common objection on r/ollama:
"Sounds like a chat template issue." It's usually the first thing to check, and it
deserves a real answer instead of a shrug — especially since the follow-up claim in
this post ("even opencode does this") is a bigger one to make without receipts.

So we checked, properly, four different ways.

## 1. The template is not misconfigured

A bad chat template usually breaks things in a uniform, structural way: garbled
output, wrong stop tokens, repetition, or native tool-calling never firing at all.
What we're seeing is different — same model, same template, same request shape,
and it's *inconsistent*: sometimes the model emits a real native tool call,
sometimes it narrates the exact same JSON as plain text instead. That's not a
plumbing mismatch; a template bug would be deterministic, not a coin flip.

We checked directly rather than argue from that alone. Here's the instruction
Ollama actually sends `qwen2.5-coder` (7B, 14B, and 32B all identical):

> "You may call one or more functions to assist with the user query. You are
> provided with function signatures within `<tools></tools>`... For each function
> call, return a json object with function name and arguments within
> `<tool_call></tool_call>` **with NO other text. Do not include any backticks or
> ```json.**"

And here's Qwen's own officially published `chat_template`, pulled directly from
[`tokenizer_config.json`](https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct/raw/main/tokenizer_config.json)
on Hugging Face:

> "You may call one or more functions to assist with the user query. You are
> provided with function signatures within `<tools></tools>` XML tags... For each
> function call, return a json object with function name and arguments within
> `<tool_call></tool_call>` XML tags."

Same instruction, near-verbatim, same special tokens, same wire format. Ollama's
version is actually *stricter* — it adds "no other text, no backticks," which
Qwen's own reference template doesn't even say. The model is being told more
forcefully than its own creator's template tells it, and still doesn't reliably
comply.

## 2. What it actually looks like when it fails

Two real, raw responses, same request (declared `read_file`/`edit_file` tools,
same prompt), no cherry-picking:

**`qwen2.5-coder:7b`**, via Ollama's OpenAI-compatible endpoint:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "{\"name\": \"read_file\", \"arguments\": {\"path\": \"sum.mjs\"}}"
    },
    "finish_reason": "stop"
  }]
}
```

**`qwen2.5-coder:32b`** — same request, same result, no `tool_calls` field, JSON
narrated as `content` instead:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "{\"name\": \"read_file\", \"arguments\": {\"path\": \"sum.mjs\"}}"
    },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 251, "completion_tokens": 19, "total_tokens": 270 }
}
```

Same `prompt_tokens` (251) confirms it's the identical request — just a much
bigger model, still failing. `finish_reason: "stop"` means the model considered
the turn *done*, not interrupted. It didn't fail to answer; it answered with the
call written as prose instead of used as an action.

## 3. Same result on a completely different serving stack

The strongest version of this test isn't "different template," it's "different
software entirely." We installed vLLM (a from-scratch setup on an RTX 5080 —
Blackwell support turned out to be fine, once a missing `ninja` build dependency
was sorted) and ran the same model through it, independent of Ollama's request
handling, template renderer, and API layer.

| Condition | Result |
|---|---|
| Ollama, plain generation | Fails — JSON narrated as text |
| vLLM, plain generation, official template verbatim, no tools API | Fails — worse. The model rambled, invented file contents it never read (`"Let's assume the content is something like this..."`), used malformed pseudo-tags, and concluded — incorrectly — that there was no bug |
| vLLM, `tool_choice: "auto"` with tool-call parsing enabled | Fails, **identically** to plain generation |
| vLLM, `tool_choice: "required"` | **Succeeds** — clean `tool_calls` array, empty `content`, correct arguments |

Two different inference engines, two different template-rendering paths, one
model, one consistent failure mode when the model is left to decide for itself.

## 4. So does constrained decoding fix it? Yes — with a real catch

The `tool_choice: "required"` result is genuine and reproducible: vLLM can force
the model's output, token by token, into a valid function-call shape, and when it
does, the model complies perfectly. That's a real, legitimate fix path, and it's
worth crediting rather than glossing over.

But it's not a "just flip a switch" fix for how agents actually run. `required`
forces a tool call on *every single turn* — including turns where the right
answer is just to respond in text. We checked the code path directly: vLLM's own
`tool_choice: "auto"` mode does not apply any generation-time constraint at all —
it's pure text parsing after the fact, architecturally the same category of
approach as what fails on Ollama. Getting "auto, but grammar-forced the moment a
tool is chosen" working requires hand-building a custom structured-output
grammar — real engineering, not a documented flag you turn on.

That's the honest, complete position: this is a real, fixable-in-principle
reliability gap, not an unfixable law of physics — but "fixable in principle
with custom grammar engineering" and "already fixed if you just configure Ollama
correctly" are very different claims, and only the first one is true.

## Where this leaves the original claim

Ruled out: chat template misconfiguration. Confirmed: cross-backend, the same
failure. Confirmed: the fix that exists (forced constrained decoding) isn't
available out of the box for a normal agent loop on either serving stack tested
here. The reliability gap is real, and Polyglot's repair-after-the-fact approach
is solving a problem that doesn't have a simpler, already-shipped answer.

## Try it

`npm install -g @usepolyglot/cli`, point it at whatever's already running on
your GPU. [Get started →](/docs/start/install)
