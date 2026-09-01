from utils.logger import setup_logger
from datasets.make_dataloader_clipreid import make_dataloader
from model.make_model_clipreid import make_model
from solver.make_optimizer_prompt import make_optimizer_1stage, make_optimizer_2stage
from solver.scheduler_factory import create_scheduler
from solver.lr_scheduler import WarmupMultiStepLR
from loss.make_loss import make_loss
from processor.processor_clipreid_stage1 import do_train_stage1
from processor.processor_clipreid_stage2 import do_train_stage2
import random
import torch
import numpy as np
import os
import argparse
from config import cfg

def set_seed(seed):
    torch.manual_seed(seed)
    torch.cuda.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = True

if __name__ == '__main__':

    parser = argparse.ArgumentParser(description="ReID Baseline Training")
    parser.add_argument(
        "--config_file", default="configs/person/vit_clipreid.yml", help="path to config file", type=str
    )

    parser.add_argument("opts", help="Modify config options using the command-line", default=None,
                        nargs=argparse.REMAINDER)
    parser.add_argument("--local_rank", default=0, type=int)
    # ADDED for Phase 1 (not in the original upstream repo — see
    # ../../../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
    # and ../LICENSE_NOTICE.md): resume support, added after losing 55/60
    # Stage 2 epochs to a real Colab GPU-quota disconnect (the upstream
    # script has no resume mechanism at all — CHECKPOINT_PERIOD only
    # controls how often a checkpoint is SAVED, not any ability to load
    # one back in and continue). --resume_from points at a
    # STAGE2-epoch checkpoint file (e.g.
    # output/veriwild_finetune/ViT-B-16_30.pth); when given, Stage 1 is
    # skipped entirely (its only job is producing the prompt-learner/image-
    # encoder weights already baked into that checkpoint) and Stage 2
    # continues from the epoch encoded in the filename, with its LR
    # scheduler fast-forwarded to match — not restarted from epoch 0's
    # warmup, which would silently corrupt the training dynamics.
    parser.add_argument(
        "--resume_from", default="", type=str,
        help="Path to a Stage2 checkpoint (ViT-B-16_<epoch>.pth) to resume from. "
             "Skips Stage 1 and continues Stage 2 from that epoch + 1."
    )
    args = parser.parse_args()

    if args.config_file != "":
        cfg.merge_from_file(args.config_file)
    cfg.merge_from_list(args.opts)
    cfg.freeze()

    set_seed(cfg.SOLVER.SEED)

    if cfg.MODEL.DIST_TRAIN:
        torch.cuda.set_device(args.local_rank)

    output_dir = cfg.OUTPUT_DIR
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    logger = setup_logger("transreid", output_dir, if_train=True)
    logger.info("Saving model in the path :{}".format(cfg.OUTPUT_DIR))
    logger.info(args)

    if args.config_file != "":
        logger.info("Loaded configuration file {}".format(args.config_file))
        with open(args.config_file, 'r') as cf:
            config_str = "\n" + cf.read()
            logger.info(config_str)
    logger.info("Running with config:\n{}".format(cfg))

    if cfg.MODEL.DIST_TRAIN:
        torch.distributed.init_process_group(backend='nccl', init_method='env://')

    train_loader_stage2, train_loader_stage1, val_loader, num_query, num_classes, camera_num, view_num = make_dataloader(cfg)

    model = make_model(cfg, num_class=num_classes, camera_num=camera_num, view_num = view_num)

    loss_func, center_criterion = make_loss(cfg, num_classes=num_classes)

    # ADDED for Phase 1: resume path. See the --resume_from help text above
    # for why this exists and what it does.
    resume_epoch = 0
    if args.resume_from:
        import re
        match = re.search(r"_(\d+)\.pth$", os.path.basename(args.resume_from))
        if not match:
            raise ValueError(
                f"--resume_from filename must match '<name>_<epoch>.pth' "
                f"(the real save pattern from processor_clipreid_stage2.py's "
                f"torch.save call), got: {args.resume_from}"
            )
        resume_epoch = int(match.group(1))
        logger.info(f"Resuming from {args.resume_from} (epoch {resume_epoch}) — skipping Stage 1 entirely.")
        model.load_state_dict(torch.load(args.resume_from, map_location="cpu"))

    if not args.resume_from:
        optimizer_1stage = make_optimizer_1stage(cfg, model)
        scheduler_1stage = create_scheduler(optimizer_1stage, num_epochs = cfg.SOLVER.STAGE1.MAX_EPOCHS, lr_min = cfg.SOLVER.STAGE1.LR_MIN, \
                            warmup_lr_init = cfg.SOLVER.STAGE1.WARMUP_LR_INIT, warmup_t = cfg.SOLVER.STAGE1.WARMUP_EPOCHS, noise_range = None)

        do_train_stage1(
            cfg,
            model,
            train_loader_stage1,
            optimizer_1stage,
            scheduler_1stage,
            args.local_rank
        )

    optimizer_2stage, optimizer_center_2stage = make_optimizer_2stage(cfg, model, center_criterion)
    scheduler_2stage = WarmupMultiStepLR(optimizer_2stage, cfg.SOLVER.STAGE2.STEPS, cfg.SOLVER.STAGE2.GAMMA, cfg.SOLVER.STAGE2.WARMUP_FACTOR,
                                  cfg.SOLVER.STAGE2.WARMUP_ITERS, cfg.SOLVER.STAGE2.WARMUP_METHOD)

    do_train_stage2(
        cfg,
        model,
        center_criterion,
        train_loader_stage2,
        val_loader,
        optimizer_2stage,
        optimizer_center_2stage,
        scheduler_2stage,
        loss_func,
        num_query, args.local_rank,
        start_epoch=resume_epoch + 1,
    )