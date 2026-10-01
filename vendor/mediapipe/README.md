# Vendored MediaPipe files

외부 CDN 변조 위험을 없애고 오프라인 배포를 가능하게 하려고 아래 파일을 저장소에 직접 포함합니다.
`tests/vendor.test.js`가 `SHA256SUMS`와 일치하는지 CI에서 확인합니다.

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `vision_bundle.mjs`, `wasm/*` | npm `@mediapipe/tasks-vision@0.10.14` (수정 없음) | Apache-2.0 |
| `pose_landmarker_full.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task` | 배포 전 MediaPipe Pose Landmarker 모델 카드의 라이선스 조건 확인 필요 |

업데이트 절차:

```sh
npm pack @mediapipe/tasks-vision@<version> && tar xzf mediapipe-tasks-vision-<version>.tgz
cp package/vision_bundle.mjs vendor/mediapipe/ && cp package/wasm/* vendor/mediapipe/wasm/
curl -o vendor/mediapipe/pose_landmarker_full.task <모델 URL>
cd vendor/mediapipe && sha256sum vision_bundle.mjs wasm/* pose_landmarker_full.task > SHA256SUMS
```
