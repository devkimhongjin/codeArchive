# CodeArchive Extension v1.0.0

This stable release routes new extension settings, dashboard, and capture traffic to the fixed CodeArchive API origin. It keeps the prior local development extension identity and legacy dashboard handoffs for installed clients during rollout.

GitHub management starts with a target choice. Repository, branch, and folder browsing stays provisional; a chosen folder connects only after its automatic server acknowledgement. Auto commit is hidden until then. Settings and GitHub choices save automatically, retain an editable draft after a failure, and expose a retry action instead of a normal settings save button.

Support administrators see the owner nickname and can archive answered inquiries, view the archive, and restore an inquiry. Difficulty badges and filtering are temporarily hidden while source collection is verified in #337; stored difficulty data remains intact.

The Chrome Web Store package omits the development key. The public store item is `mlhibjadcbklfdllkonhjjajhmhnoalj`; the local developer identity remains separate for compatibility. The stable 1.0.0 release removes product-facing Beta labels. GitHub App installation and OAuth returns use fixed, signed routes and do not expose account credentials to extension pages.

The Web Store workflow uses short-lived workload-identity credentials and submits `DEFAULT_PUBLISH` for review after source verification. Store publication may enter review after upload. A successful workflow submission does not assert that the version is publicly available until Chrome Web Store reports it as published.
