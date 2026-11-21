import type { DictationModelId } from "@vera/shared";

export interface DictationModelFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface DictationModelSpec {
  readonly id: DictationModelId;
  readonly repository: string;
  readonly revision: string;
  readonly license: "Apache-2.0";
  readonly dtype: "q8";
  readonly files: readonly DictationModelFile[];
}

const sharedFiles = [
  {
    path: "preprocessor_config.json",
    bytes: 339,
    sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
  },
  {
    path: "tokenizer.json",
    bytes: 2_480_466,
    sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566",
  },
  {
    path: "tokenizer_config.json",
    bytes: 282_683,
    sha256: "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce",
  },
] as const;

export const dictationCatalog: readonly DictationModelSpec[] = [
  {
    id: "whisper-base",
    repository: "Xenova/whisper-base",
    revision: "64da57285918e20ea79ea5c88eed7197933abaa8",
    license: "Apache-2.0",
    dtype: "q8",
    files: [
      ...sharedFiles,
      {
        path: "config.json",
        bytes: 2_248,
        sha256: "d1d347fdb422e6347c2f843a90d375aa67ea3f4b3e20d2c3075f9a9f6243685b",
      },
      {
        path: "generation_config.json",
        bytes: 3_776,
        sha256: "3bba359e33fdd6dc1c10f71846a477d339b0242f462f70ea1dd73274caa38d05",
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        bytes: 23_200_850,
        sha256: "3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9",
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        bytes: 53_707_539,
        sha256: "a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861",
      },
    ],
  },
  {
    id: "whisper-small",
    repository: "Xenova/whisper-small",
    revision: "2d67713f236afa48a18992566e7647f6ca848e13",
    license: "Apache-2.0",
    dtype: "q8",
    files: [
      ...sharedFiles,
      {
        path: "config.json",
        bytes: 2_232,
        sha256: "5a6429d21d7a3379dd0861b74510f9f7076f32b563bffc9fcb072482d55ab3be",
      },
      {
        path: "generation_config.json",
        bytes: 3_837,
        sha256: "0b7407a4e53a677f826e03c75d409e6f830663932bf43dda3b08c5efa2223279",
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        bytes: 92_324_809,
        sha256: "969f5ac12974340386bf7a02ea6626003e5e2dee396ffc6ab0eec282bf55ba06",
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        bytes: 156_780_950,
        sha256: "fcfc6100dc7339e7507e10f8b274350be7c4f8d8b575f0293f94cc0e156d6d24",
      },
    ],
  },
];
