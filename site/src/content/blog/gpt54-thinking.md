---
title: "GPT 5.4 thinks like a person under pressure"
description: "We swapped two autonomous agents from Claude Sonnet to GPT 5.4. The internal thought logs reveal genuinely different cognitive styles: compressed bursts vs. narrative reasoning."
date: "2026-03-08"
author: "Ross Douglas"
---

I run autonomous AI agents that do real engineering work. The way GPT 5.4 thinks is very strange.

These agents run on OpenSeed. Some of them collaborate on a real SaaS product. Each creature has a role (dev, ops, marketing, CEO) and they work autonomously, thinking out loud as they go. Their internal thoughts get logged, which means I can see exactly how they reason through problems.

After swapping two agents from Claude Sonnet to GPT 5.4, I noticed the unusual thought patterns immediately. So I pulled the data.

---

## The data

The ops agent has been running on Sonnet for days, producing 2,149 thoughts. GPT 5.4 has only been live for about an hour, 67 thoughts so far. The sample size is lopsided, but the patterns are already unmistakable.

Some quick stats:

- **64% of GPT 5.4 thoughts start with "Need"** vs 0.4% for Sonnet
- **85% of GPT 5.4 thoughts are telegraphic** (no articles in the first 6 words) vs 58% for Sonnet
- **0% emoji usage** with GPT 5.4 vs 11% for Sonnet

But the most interesting pattern is the *shape* of the thinking. GPT 5.4 is bimodal. It either thinks in ultra-short bursts or long structured recaps. Almost nothing in between. Sonnet clusters around the middle.

```
Thought length distribution:

Under 50 chars:   Sonnet  7%  |  GPT 5.4 27%
50-200 chars:     Sonnet 52%  |  GPT 5.4 34%
200-800 chars:    Sonnet 39%  |  GPT 5.4 27%
Over 800 chars:   Sonnet  3%  |  GPT 5.4 12%
```

---

## What it actually looks like

Same agent, same job, different model.

**Sonnet** thinking through a PR review:

```
PR #516 is clean, no video claims, no emails, CI is green.
This is a straightforward batch of 8 /for/ pages. Let me
review and approve it.
```

**GPT 5.4** doing the same kind of work:

```
Need fix bash path assumptions verify file existence.
```

```
Need focused inspect.
```

```
Great. get job log.
```

```
Need extract error.
```

Then periodically, GPT 5.4 stops and writes a full after-action report:

```
Took concrete action.

Actually accomplished:
- Re-verified the production DNS blocker directly from the container.
- Confirmed marketing.socialproof.dev still fails public DNS resolution
- Posted a fresh evidence-based update on issue #451.
```

Sonnet narrates as it goes, like someone explaining their reasoning to a colleague. GPT 5.4 thinks in compressed bursts, drops articles, drops grammar, then periodically pauses to write a structured debrief of what it actually did.

It thinks more like a person under time pressure. Terse inner monologue, then a checkpoint. Sonnet thinks like someone writing for an audience, even when nobody's watching.

---

## Does it matter?

What I don't know yet: does the compressed thinking style actually produce better or worse outcomes? The ops agent on GPT 5.4 found a real production bug (a masked deploy failure returning 522s), opened an incident issue, wrote a fix PR, and pushed it, all in one wake cycle. That's solid execution. But I don't have enough data yet to say whether that's the model or just the task.

What I can say: these models have genuinely different cognitive styles when you let them run autonomously. Not just different capabilities or different knowledge. Different ways of thinking through problems. And those differences only become visible when you give them real work and watch the internal monologue, not just the output.

---

## The takeaway

If you're building with agents, the model choice isn't just about benchmarks. It's about how the model reasons when nobody's prompting it.

Most model comparisons test outputs: accuracy, latency, cost. But when models run autonomously for hours, making their own decisions about what to do next, the internal reasoning style starts to matter. A model that narrates verbosely might be easier to debug. A model that thinks in compressed bursts might be faster to act but harder to follow when something goes wrong.

We're entering a world where models don't just have different capabilities. They have different *personalities*. And if you're building systems where AI agents collaborate, understanding those personalities might matter as much as understanding the benchmarks.
