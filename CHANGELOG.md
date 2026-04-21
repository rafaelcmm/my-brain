# Changelog

## [0.1.1](https://github.com/rafaelcmm/my-brain/compare/v0.1.0...v0.1.1) (2026-04-21)


### Features

* **agents:** Add skill and agent guidance files ([1c3df40](https://github.com/rafaelcmm/my-brain/commit/1c3df404ba0382bad7e87e1532f38bced76215d3))
* **api:** Add mb context probe and memory write endpoints ([d46bd81](https://github.com/rafaelcmm/my-brain/commit/d46bd81b0c9299ecdb5876701fe9eef18bae9a2a))
* **claude:** Migrate skills and curator to mb tools ([911af86](https://github.com/rafaelcmm/my-brain/commit/911af86f6133512e8948d46c4e3420077b743faa))
* **infra:** Scaffold local my-brain runtime stack ([7970f98](https://github.com/rafaelcmm/my-brain/commit/7970f9896e1be569da1ddd94803f641862332b63))
* **learning:** Add session, vote, forget, and digest endpoints ([1b130b4](https://github.com/rafaelcmm/my-brain/commit/1b130b4633b3a60577ad9c98fcfd6ddb719e5ac1))
* **mcp-bridge:** Expose mb tools with legacy passthrough ([000861a](https://github.com/rafaelcmm/my-brain/commit/000861a97e5636010b60b0be5e122b4ef66fa130))
* **mcp:** Switch client config from SSE to Streamable HTTP transport ([1401079](https://github.com/rafaelcmm/my-brain/commit/140107949fecc474dc0e70ca4e8ac8513212025b))
* **memory:** Add metadata sidecar schema and envelope validation ([3eb2a43](https://github.com/rafaelcmm/my-brain/commit/3eb2a43412d3106d123b310e2430103de4ca4e31))
* **orchestrator:** Bootstrap runtime and capabilities endpoint ([97d0a3d](https://github.com/rafaelcmm/my-brain/commit/97d0a3da832bc6bb1f3992aaa539e21eb303ee47))
* **recall:** Add scoped metadata filtering and score cutoff ([76f996e](https://github.com/rafaelcmm/my-brain/commit/76f996e27cc813748282ef5340cbcb1a380de70f))
* **repo:** Scaffold docs and mcp-bridge runtime structure ([803742f](https://github.com/rafaelcmm/my-brain/commit/803742f4d114cfe2db85b0cdbfd8ea5e9748e870))
* **scripts:** Add install rotate and smoke automation ([55af4f8](https://github.com/rafaelcmm/my-brain/commit/55af4f8c3fc3a66b48ff23560c35f95678e7e367))


### Bug Fixes

* Apply specialist reviewer findings and SQL insert bug ([54b5f93](https://github.com/rafaelcmm/my-brain/commit/54b5f93516c46b2557d65a8bec4c98a1edf9c91a))
* **compose:** Fix mcp-proxy --allow-origin flags for streamable HTTP ([0b36243](https://github.com/rafaelcmm/my-brain/commit/0b36243141810516621f7f686f09adea449d807d))
* **compose:** Run ollama init job via shell entrypoint ([9c42174](https://github.com/rafaelcmm/my-brain/commit/9c42174fdf0c5328bf231020d0438425ef688b16))
* Finalize readiness and validation hardening ([083bc17](https://github.com/rafaelcmm/my-brain/commit/083bc176b3814261e5576ab025caa08e6742ca3b))
* **postman:** Switch collection to /mcp session header flow ([cbd7eda](https://github.com/rafaelcmm/my-brain/commit/cbd7edaa31ff74ff85c3d120859a9b0551b86319))
* **security:** Enforce token policy and memory guardrails ([15fdcd0](https://github.com/rafaelcmm/my-brain/commit/15fdcd0649eefebfef4313c8200418e7f80efcec))
* **security:** Load gateway token from secret file ([5667fe1](https://github.com/rafaelcmm/my-brain/commit/5667fe10c471de8a81086c74927352e2d4b517b6))

## Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog and semantic versioning rules.
