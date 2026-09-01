# Handing Off Training to a Different Device/Colab Account

**When to use this:** your Colab GPU quota runs out mid-training, and you
want to continue the *same* training run on a different device or a
different Google/Colab account (fresh GPU quota), rather than wait for
your own quota to refresh.

**What this is NOT:** this is not a way to split the 500 (or 10,000)
vehicles across multiple people training independent chunks. That doesn't
work — see "Why you can't just merge separate training runs" below. This
document is specifically about **one continuous training run**, relayed
across different machines/accounts, resumed from a checkpoint each time.

---

## Why this works

Model fine-tuning produces one shared set of weights that gets nudged a
tiny bit by every batch of training images, building on everything
before it. The saved checkpoint file (`ViT-B-16_<epoch>.pth`) *is* the
model's current state — a complete snapshot. Continuing training from
that file is mathematically identical whether it's the same person on
the same laptop, or a different person on a different Colab account
across the world. The GPU executing the next batch doesn't know or care
who started the run.

This project already has real resume support built in — see
`README.md`'s section on Colab and `phase1_finetune.ipynb`'s **"5b.
Resume after a disconnect"** section. Handing off to a different
device/account uses the exact same mechanism; the only new step is
*moving the checkpoint file* between people/machines.

---

## Why you can't just merge separate training runs

If two different people each trained a copy of the model independently
on different subsets of vehicles (e.g. Person A trains on vehicles 1-500,
Person B trains on vehicles 501-900), you would **not** get one smarter
900-vehicle model by combining their `.pth` files afterward. Two real,
concrete reasons:

1. **The weights diverge in incompatible directions.** Each independent
   training run nudges the same starting weights differently, based on
   what it saw. Averaging or merging two independently-trained weight
   sets is a genuinely hard, unsolved-in-general ML research problem
   ("model merging") — it does not work as a naive file-combining trick,
   and in most cases actively breaks both models' learned behavior.
2. **The internal structure literally doesn't match.** CLIP-ReID's
   `PromptLearner` (identity classifier) and `SIE_CAMERA` (camera-aware
   embedding) both build internal tables sized exactly to however many
   vehicle identities / cameras are in *that specific* training run. A
   model trained on 500 vehicles has a different internal shape than one
   trained on a different 400 vehicles — they aren't even the same shape
   to attempt combining, let alone semantically compatible.

**Bottom line:** if you want a model that has learned from more vehicles,
train continuously on the full combined set (e.g. all 10,000 at once, or
resume-extend a run) — not train separately and merge afterward.

---

## The actual hand-off procedure

### What to send the next person

| File | Where it comes from |
|---|---|
| The latest checkpoint, e.g. `ViT-B-16_50.pth` | Your Google Drive: `veriwild_finetune_output/` |
| `CLIP-ReID-with-data.zip` | `training/` in this repo |
| `blur_augmentation.py` | `training/` in this repo |
| `src/degrade.py` (+ empty `src/__init__.py`) | `../src/` in this repo |
| `phase1_finetune.ipynb` | `training/` in this repo |

Transfer these however is convenient — a shared Google Drive folder link,
direct file transfer, USB drive, etc. The checkpoint file is the only one
that's specific to *this* training run; the other four are the same
static files used for any fresh start too.

### What the next person does

1. Upload all five items to **their own** Google Drive (or wherever
   they'll run Colab from) — not yours. Each Colab account's Drive is
   separate.
2. Open `phase1_finetune.ipynb` in their Colab.
3. Run through sections 1-4 as normal (mount Drive, upload/extract the
   zip and the two small `.py` files, install dependencies, confirm GPU).
4. Skip section **5a (fresh start)**. Go straight to section **5b
   (Resume after a disconnect)**.
5. In the resume cell, set:
   ```python
   RESUME_CHECKPOINT = '/content/drive/MyDrive/veriwild_finetune_output/ViT-B-16_50.pth'
   ```
   pointing at wherever *they* uploaded the checkpoint file in step 1 —
   not the original path from your Drive.
6. Run it. Training continues from epoch 51 (or whatever epoch the
   filename encodes, plus one) exactly as if you had resumed it yourself.
   Their session now saves its own new checkpoints (`ViT-B-16_60.pth`,
   etc.) to *their* Drive as training continues.

### Getting the result back

Once their session finishes (or they hit their own quota limit and it's
your turn again), they send you back the latest `.pth` checkpoint the
same way you sent it to them. Repeat the relay as many times as needed
across however many accounts/devices, until training reaches the final
epoch (60, per the current config).

Only the **very last** checkpoint needs converting to ONNX (`phase1_finetune.ipynb`
section 7) — do this once, after the full run is actually complete, not
after every hand-off.
