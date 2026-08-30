import { createServer } from './app.js';
import { createConversationResponderFromEnvironment } from './conversationResponder.js';

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const server = createServer({ conversationResponder: createConversationResponderFromEnvironment() });

server.listen(port, () => {
  console.log(`The Verifier server listening on port ${port}`);
});
