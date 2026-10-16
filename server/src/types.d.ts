import 'fastify';
import type { AppContext } from './context.js';
import type { Principal } from './security/principal.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    /** A signed-in person (Bearer or cookie). Never a kiosk device. */
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** A person or a paired kiosk device; use only on read-only routes. */
    requireViewer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Legacy name used by the original sync routes; same as requireUser. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    principal: Principal | null;
    userId: string;
  }
}
