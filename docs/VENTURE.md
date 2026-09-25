# Karyon: venture brief

## The problem

Quantitative pathology (counting nuclei, scoring Ki-67, measuring morphology) is still done by eye in most labs, or with desktop tools that need a workstation, a trained operator and an IT approval cycle. Cloud AI platforms solve the accuracy problem but create two new ones: every slide has to be uploaded, which triggers privacy, data-residency and procurement reviews, and every analysis costs GPU time, which makes per-case pricing hard for smaller labs and for emerging markets.

## The wedge

Karyon runs the whole pipeline inside the browser. The model is 3.7 MB, inference uses WebGPU or WebAssembly on the machine the pathologist already has, and the page is technically unable to send pixels anywhere else (enforced by the Content Security Policy). That gives three structural advantages:

1. **No data processing agreement to start.** Patient images never reach Karyon's servers, so a lab can try it the same day.
2. **Near-zero marginal cost.** Compute is on the client, so a free tier is sustainable and paid plans are priced on value, not GPU hours.
3. **Works where cloud AI does not:** air-gapped hospital networks, poor connectivity, and regions with strict data-residency law.

## Customers and business model

| Segment | Buyer | Offer |
|---|---|---|
| Academic and pharma research labs | PI, core facility manager | Free Studio, paid batch and whole-slide features |
| Diagnostic and hospital labs | Lab director, pathology IT | Lab plan: validated protocols, audit trail, SSO, on-prem |
| CROs running IHC studies | Study director | Per-study licence, reproducible scoring reports |
| Scanner, LIS and viewer vendors | Product and partnerships | Embeddable SDK, custom models, white label |

## Moat over time

* A data flywheel that respects privacy: assisted annotation in the viewer, with optional federated or on-device fine-tuning so models improve without centralising patient data.
* Validated, versioned protocols (model hash, thresholds, calibration) that labs can cite in SOPs and regulatory files.
* An integration surface (QuPath, DICOM WSI, FHIR) that makes Karyon the default quantification layer inside other tools.

## Adjacent products on the same engine

The browser inference stack, stain toolkit, tiling and parity-tested post-processing are reusable. Each of these is a separate, fundable product:

1. **Slide QC.** Detect blur, tissue folds, pen marks, bubbles and stain failures at scan time, before a pathologist ever opens the slide. Buyer: scanner-heavy labs and digitisation projects.
2. **TIL and immune scoring.** Tumour-infiltrating lymphocyte density per the international TILs working group guidance for breast cancer, as a companion to the nucleus engine plus a cell-type head.
3. **Cytology triage.** Cell-level screening for Pap smears and fine-needle aspirates, where volume is high and pathologist time is scarce.
4. **3D nuclei for spatial biology.** The same multi-head approach in 3D (MONAI, anisotropic U-Net) for confocal and light-sheet stacks, feeding spatial transcriptomics and organoid screening.
5. **Veterinary pathology.** Mast cell tumour grading and mitotic counts for veterinary labs, a market with fewer regulatory barriers and fast adoption.

## Regulatory path

Research-use-only first. The architecture (fixed model versions, deterministic post-processing, full parameter reports) is designed so that a specific intended use, for example Ki-67 index in breast cancer, can later be validated for IVDR (EU) or FDA clearance without rebuilding the product.

## Next milestones

1. Fine-tune on licensed real annotations and publish a real-tissue benchmark.
2. Whole-slide streaming (pyramidal TIFF, SVS) with hotspot detection for Ki-67.
3. Five design-partner labs across two regions, measuring time saved per case against manual scoring.
