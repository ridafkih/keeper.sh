import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

console.log('ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
console.log('HEADERS:', process.env.OTEL_EXPORTER_OTLP_HEADERS);

const exporter = new OTLPLogExporter();
const provider = new LoggerProvider({
  resource: resourceFromAttributes({ 'service.name': 'test-direct' }),
  processors: [{ 
    onEmit(record) { exporter.export([record], (result) => console.log('export result:', JSON.stringify(result))); },
    shutdown() { return exporter.shutdown(); },
    forceFlush() { return Promise.resolve(); }
  }],
});

const logger = provider.getLogger('test');
logger.emit({ body: 'direct otel test log', severityText: 'INFO' });

setTimeout(async () => {
  await provider.forceFlush();
  await provider.shutdown();
  console.log('shutdown complete');
  process.exit(0);
}, 5000);
