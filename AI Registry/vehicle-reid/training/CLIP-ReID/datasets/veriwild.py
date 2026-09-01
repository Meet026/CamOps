from __future__ import absolute_import
from __future__ import division
from __future__ import print_function
import os.path as osp
from .bases import BaseImageDataset

"""
VeRi-Wild dataset class for CLIP-ReID training.

Chosen for Phase 1 specifically because VeRi-Wild's 174 cameras (vs.
VeRi-776's 20) give the model far more distinct scenes per vehicle
identity, directly working against the background/camera-context bias
diagnosed in Phase 0 (see
../../../../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
section 1.3).

Real file format, verified directly against the downloaded dataset
(Kaggle mirror: mrkdagods/veriwild-test) before writing this class — not
assumed:

    <root>/train_list_start0.txt   "<vehicle_id>/<image_id>.jpg <pid> <camid>"
      e.g. "11542/119083.jpg 0 23" — already-relabeled pid (0-indexed),
      camera id as the third column. This is the OFFICIAL train split,
      already pid-relabeled — used directly, not re-derived.

    <root>/test_3000_id.txt        same 3-column format, for the gallery
    <root>/test_3000_id_query.txt  same 3-column format, for the query set
      (VeRi-Wild ships 3 test set sizes — 3000/5000/10000 identities;
      Phase 1 uses the smallest, 3000, sufficient for spot-checking during
      training and consistent with keeping this dataset TRAINING-only —
      VRIC remains the real evaluation set, see spec section 3)

    <root>/images/<vehicle_id>/<image_id>.jpg   the actual image files

No viewpoint annotation exists for VeRi-Wild (unlike VeRi-776's keypoint
files) — following the same honest approach as the reference VehicleID
class (datasets/vehicleid.py), viewid is set to a constant placeholder (1)
rather than fabricating a real viewpoint signal that doesn't exist.
"""


class VeriWild(BaseImageDataset):
    """
    VeRi-Wild
    Reference:
    Lou, Yihang, et al. "VERI-Wild: A Large Dataset and a New Method for
    Vehicle Re-Identification in the Wild." CVPR 2019.

    Dataset statistics (train split, verified against the real downloaded
    files):
    # identities: 30,671 (train)
    # images: 277,797 (train)
    # cameras: 174
    """

    dataset_dir = ""

    def __init__(self, root="", verbose=True, test_size=3000, **kwargs):
        super(VeriWild, self).__init__()
        self.dataset_dir = osp.join(root, self.dataset_dir)
        self.img_dir = osp.join(self.dataset_dir, "images")
        self.train_list = osp.join(self.dataset_dir, "train_list_start0.txt")
        self.test_size = test_size
        self.gallery_list = osp.join(self.dataset_dir, f"test_{test_size}_id.txt")
        self.query_list = osp.join(self.dataset_dir, f"test_{test_size}_id_query.txt")

        self._check_before_run()

        train = self._process_list(self.train_list)
        query = self._process_list(self.query_list)
        gallery = self._process_list(self.gallery_list)

        if verbose:
            print("=> VeRi-Wild loaded")
            self.print_dataset_statistics(train, query, gallery)

        self.train = train
        self.query = query
        self.gallery = gallery

        self.num_train_pids, self.num_train_imgs, self.num_train_cams, self.num_train_vids = self.get_imagedata_info(
            self.train)
        self.num_query_pids, self.num_query_imgs, self.num_query_cams, self.num_query_vids = self.get_imagedata_info(
            self.query)
        self.num_gallery_pids, self.num_gallery_imgs, self.num_gallery_cams, self.num_gallery_vids = self.get_imagedata_info(
            self.gallery)

    def _check_before_run(self):
        """Check if all files are available before going deeper"""
        if not osp.exists(self.dataset_dir):
            raise RuntimeError("'{}' is not available".format(self.dataset_dir))
        if not osp.exists(self.img_dir):
            raise RuntimeError("'{}' is not available".format(self.img_dir))
        if not osp.exists(self.train_list):
            raise RuntimeError("'{}' is not available".format(self.train_list))
        if not osp.exists(self.gallery_list):
            raise RuntimeError("'{}' is not available".format(self.gallery_list))
        if not osp.exists(self.query_list):
            raise RuntimeError("'{}' is not available".format(self.query_list))

    def _process_list(self, list_path):
        """
        Parses a VeRi-Wild split file: lines of
        "<vehicle_id>/<image_id>.jpg <pid> <camid>"
        Returns [(img_path, pid, camid, viewid), ...] — the 4-tuple shape
        BaseDataset.get_imagedata_info (bases.py) requires. viewid is a
        constant placeholder (1) since VeRi-Wild has no real viewpoint
        annotation, matching the reference VehicleID class's own approach.
        """
        dataset = []
        with open(list_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                relative_path, pid_str, camid_str = line.split(" ")
                img_path = osp.join(self.img_dir, relative_path)
                pid = int(pid_str)
                camid = int(camid_str)
                viewid = 1
                dataset.append((img_path, pid, camid, viewid))
        return dataset
