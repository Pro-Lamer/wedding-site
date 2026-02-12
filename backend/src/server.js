import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { query } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.FRONTEND_URL || true,
  credentials: true
});

await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret' });

app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ message: 'Unauthorized' });
  }
});

app.get('/health', async () => ({ ok: true }));

app.post('/api/v1/auth/register', async (request, reply) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    inn: z.string().min(10).max(12)
  });

  const data = schema.parse(request.body);

  const existing = await query('SELECT id FROM companies WHERE inn=$1', [data.inn]);
  if (existing.rowCount > 0) {
    return reply.code(409).send({ message: 'Company with INN already exists' });
  }

  const passwordHash = await hashPassword(data.password);
  const company = await query(
    `INSERT INTO companies (inn, name_full, name_short, verification_level)
     VALUES ($1, $2, $3, 'L1_registry')
     RETURNING id, inn`,
    [data.inn, `Компания ${data.inn}`, `Компания ${data.inn}`]
  );

  const user = await query(
    `INSERT INTO users (company_id, email, password_hash, role)
     VALUES ($1, $2, $3, 'company_admin')
     RETURNING id, email, company_id`,
    [company.rows[0].id, data.email, passwordHash]
  );

  const tokenPayload = { userId: user.rows[0].id, companyId: user.rows[0].company_id, role: 'company_admin' };
  const accessToken = await reply.jwtSign(tokenPayload, { expiresIn: '15m' });
  const refreshToken = await reply.jwtSign(tokenPayload, { expiresIn: '30d' });

  return reply.code(201).send({ accessToken, refreshToken, user: user.rows[0], company: company.rows[0] });
});

app.post('/api/v1/auth/login', async (request, reply) => {
  const schema = z.object({ email: z.string().email(), password: z.string() });
  const data = schema.parse(request.body);

  const result = await query('SELECT id, email, password_hash, company_id, role FROM users WHERE email=$1', [data.email]);
  if (!result.rowCount) return reply.code(401).send({ message: 'Invalid credentials' });

  const user = result.rows[0];
  const ok = await verifyPassword(data.password, user.password_hash);
  if (!ok) return reply.code(401).send({ message: 'Invalid credentials' });

  await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);

  const tokenPayload = { userId: user.id, companyId: user.company_id, role: user.role };
  const accessToken = await reply.jwtSign(tokenPayload, { expiresIn: '15m' });
  const refreshToken = await reply.jwtSign(tokenPayload, { expiresIn: '30d' });

  return { accessToken, refreshToken };
});

app.post('/api/v1/auth/refresh', async (request, reply) => {
  const schema = z.object({ refreshToken: z.string() });
  const data = schema.parse(request.body);
  try {
    const payload = await app.jwt.verify(data.refreshToken);
    const tokenPayload = { userId: payload.userId, companyId: payload.companyId, role: payload.role };
    const accessToken = await reply.jwtSign(tokenPayload, { expiresIn: '15m' });
    const refreshToken = await reply.jwtSign(tokenPayload, { expiresIn: '30d' });
    return { accessToken, refreshToken };
  } catch {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }
});

app.post('/api/v1/companies/verify-inn', { preHandler: [app.authenticate] }, async (request) => {
  const schema = z.object({ inn: z.string().min(10).max(12) });
  const { inn } = schema.parse(request.body);

  return {
    full_name: `ООО Заглушка ${inn}`,
    short_name: `Заглушка ${inn}`,
    ogrn: '0000000000000',
    inn,
    kpp: '000000000',
    status: 'active',
    reg_date: '2020-01-01',
    legal_address: 'РФ, г. Москва, ул. Пример, д. 1',
    okved_main: '62.01',
    okved_additional: ['62.02', '63.11'],
    _stub_note: 'Требуется подключение внешнего провайдера ЕГРЮЛ'
  };
});

app.get('/api/v1/companies/me', { preHandler: [app.authenticate] }, async (request) => {
  const company = await query('SELECT * FROM companies WHERE id=$1', [request.user.companyId]);
  return company.rows[0];
});

app.patch('/api/v1/companies/me', { preHandler: [app.authenticate] }, async (request) => {
  const schema = z.object({
    description: z.string().max(5000).optional(),
    website: z.string().optional(),
    regionCode: z.string().optional(),
    contactsEmail: z.string().email().optional(),
    contactsPhone: z.string().optional()
  });
  const data = schema.parse(request.body);

  const updated = await query(
    `UPDATE companies SET
      description = COALESCE($1, description),
      website = COALESCE($2, website),
      region_code = COALESCE($3, region_code),
      contacts_email = COALESCE($4, contacts_email),
      contacts_phone = COALESCE($5, contacts_phone),
      updated_at = NOW()
    WHERE id = $6
    RETURNING *`,
    [data.description ?? null, data.website ?? null, data.regionCode ?? null, data.contactsEmail ?? null, data.contactsPhone ?? null, request.user.companyId]
  );

  return updated.rows[0];
});

app.get('/api/v1/posts', { preHandler: [app.authenticate] }, async (request) => {
  const { type, q } = request.query;
  const params = [];
  const where = ["p.status = 'active'"];

  if (type) {
    params.push(type);
    where.push(`p.type = $${params.length}`);
  }

  if (q) {
    params.push(q);
    where.push(`p.search_tsv @@ plainto_tsquery('russian', $${params.length})`);
  }

  const sql = `
    SELECT p.*, c.name_short AS company_name
    FROM posts p
    JOIN companies c ON c.id = p.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT 50`;

  const result = await query(sql, params);
  return { items: result.rows };
});

app.post('/api/v1/posts', { preHandler: [app.authenticate] }, async (request, reply) => {
  const schema = z.object({
    type: z.enum(['request', 'offer']),
    title: z.string().max(200),
    description: z.string().max(5000),
    categoryId: z.string().uuid().nullable().optional(),
    budgetMin: z.number().nullable().optional(),
    budgetMax: z.number().nullable().optional(),
    regionCode: z.string().optional(),
    remoteFlag: z.boolean().default(false),
    deadlineDate: z.string().nullable().optional()
  });

  const data = schema.parse(request.body);

  const result = await query(
    `INSERT INTO posts
      (company_id, type, title, description, category_id, budget_min, budget_max, region_code, remote_flag, deadline_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      request.user.companyId,
      data.type,
      data.title,
      data.description,
      data.categoryId ?? null,
      data.budgetMin ?? null,
      data.budgetMax ?? null,
      data.regionCode ?? null,
      data.remoteFlag,
      data.deadlineDate ?? null
    ]
  );

  return reply.code(201).send(result.rows[0]);
});

app.post('/api/v1/posts/:id/responses', { preHandler: [app.authenticate] }, async (request, reply) => {
  const schema = z.object({
    price: z.number().nullable().optional(),
    timelineDays: z.number().int().nullable().optional(),
    message: z.string().max(5000)
  });
  const data = schema.parse(request.body);

  const result = await query(
    `INSERT INTO responses (post_id, company_id, price, timeline_days, message)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [request.params.id, request.user.companyId, data.price ?? null, data.timelineDays ?? null, data.message]
  );

  return reply.code(201).send(result.rows[0]);
});

app.get('/api/v1/my/responses', { preHandler: [app.authenticate] }, async (request) => {
  const result = await query(
    `SELECT r.*, p.title AS post_title
     FROM responses r
     JOIN posts p ON p.id = r.post_id
     WHERE r.company_id = $1
     ORDER BY r.created_at DESC`,
    [request.user.companyId]
  );

  return { items: result.rows };
});

app.post('/api/v1/reports', { preHandler: [app.authenticate] }, async (request, reply) => {
  const schema = z.object({
    targetType: z.enum(['company', 'post', 'response', 'review']),
    targetId: z.string().uuid(),
    reason: z.string().min(2),
    comment: z.string().optional()
  });
  const data = schema.parse(request.body);

  const result = await query(
    `INSERT INTO reports (reporter_company_id, target_type, target_id, reason, comment)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [request.user.companyId, data.targetType, data.targetId, data.reason, data.comment ?? null]
  );
  return reply.code(201).send(result.rows[0]);
});

app.post('/api/v1/companies/:id/unlock', { preHandler: [app.authenticate] }, async (request) => {
  return {
    status: 'stub',
    message: 'Требуется интеграция с платежным провайдером. Пока доступна только заглушка.'
  };
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ message: 'Validation error', issues: error.issues });
  }
  app.log.error(error);
  return reply.status(500).send({ message: 'Internal server error' });
});

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
