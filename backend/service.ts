import node from '@prisma/composer/node';
import { secretString } from '@prisma/composer/zod';
import { compute, rawPostgres } from '@prisma/composer-prisma-cloud';
import { z } from 'zod';
export default compute({
    name: 'api',
    input: z.object({ token: secretString(), paypalClientId: secretString().optional(), paypalSecret: secretString().optional(), paypalWebhookId: z.string().optional() }),
    deps: { db: rawPostgres() },
    build: node({ module: import.meta.url, entry: './dist/server.mjs' }),
});
