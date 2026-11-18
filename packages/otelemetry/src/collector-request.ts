import { CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base";

const COLLECTOR_REQUEST_OPTIONS = { compression: CompressionAlgorithm.GZIP };

export { COLLECTOR_REQUEST_OPTIONS };
