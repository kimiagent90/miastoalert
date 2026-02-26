import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import cron from 'node-cron'
import crypto from 'crypto'
import { Pool } from 'pg'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const {
  PORT = 5000,
  DATABASE_URL,
  JWT_SECRET,
  CORS_ORIGIN = 'http://localhost:5173',
  OWNER_EMAIL,
  OWNER_PASSWORD,
} = process.env

if (!DATABASE_URL) {
  console.error('Brak zmiennej środowiskowej DATABASE_URL')
  process.exit(1)
}

if (!JWT_SECRET) {
  console.error('Brak zmiennej środowiskowej JWT_SECRET')
  process.exit(1)
}

if (!OWNER_EMAIL || !OWNER_PASSWORD) {
  console.warn('Uwaga: OWNER_EMAIL i OWNER_PASSWORD nie są ustawione. Panel administracyjny będzie niedostępny, dopóki ich nie skonfigurujesz.')
}

const pool = new Pool({
  connectionString: DATABASE_URL,
})

async function initDb() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      role text not null check (role in ('owner', 'moderator', 'user')),
      email text unique,
      password_hash text,
      city text not null,
      rating integer not null default 0,
      banned boolean not null default false,
      created_at timestamptz not null default now()
    );
  `)

  await pool.query(`
    create table if not exists reports (
      id text primary key,
      city text not null,
      type text not null check (type in ('policja', 'kontrola')),
      street text not null,
      bus_number text,
      direction text,
      lat double precision not null,
      lng double precision not null,
      created_at timestamptz not null default now(),
      confirmations_count integer not null default 0,
      user_id text references users (id) on delete set null
    );
  `)

  await pool.query(`
    create table if not exists confirmations (
      user_id text references users (id) on delete cascade,
      report_id text references reports (id) on delete cascade,
      confirmed_at timestamptz not null default now(),
      primary key (user_id, report_id)
    );
  `)

  // pojedynczy owner
  if (OWNER_EMAIL && OWNER_PASSWORD) {
    const existing = await pool.query('select id from users where role = $1 limit 1', ['owner'])
    if (existing.rowCount === 0) {
      const id = `user_${crypto.randomUUID()}`
      const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10)
      await pool.query(
        `insert into users (id, role, email, password_hash, city) values ($1, 'owner', $2, $3, $4)`,
        [id, OWNER_EMAIL, passwordHash, 'Warszawa'],
      )
      console.log('Utworzono użytkownika owner na podstawie OWNER_EMAIL/OWNER_PASSWORD')
    }
  }
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' })
}

function authOptional(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    req.user = null
    return next()
  }
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
  } catch {
    req.user = null
  }
  next()
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Brak autoryzacji' })
  }
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.banned) {
      return res.status(403).json({ message: 'Konto zablokowane' })
    }
    req.user = payload
    return next()
  } catch {
    return res.status(401).json({ message: 'Nieprawidłowy token' })
  }
}

function requireRole(requiredRoles) {
  return (req, res, next) => {
    if (!req.user || !requiredRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Brak uprawnień' })
    }
    return next()
  }
}

const createReportLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Zbyt wiele zgłoszeń, spróbuj ponownie za chwilę.' },
})

const app = express()

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
)
app.use(
  cors({
    origin: CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: false,
  }),
)
app.use(express.json())
app.use(cookieParser())

// API

app.post('/api/auth/anonymous', async (req, res) => {
  try {
    const { city } = req.body || {}
    if (!city || typeof city !== 'string') {
      return res.status(400).json({ message: 'Miasto jest wymagane.' })
    }

    const id = `user_${crypto.randomUUID()}`
    await pool.query(
      `insert into users (id, role, city) values ($1, 'user', $2)`,
      [id, city],
    )

    const token = signToken({ id, role: 'user', city, banned: false })
    return res.json({ token, user: { id, role: 'user', city, rating: 0 } })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Błąd serwera' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ message: 'Email i hasło są wymagane.' })
    }
    const result = await pool.query('select * from users where email = $1 limit 1', [email])
    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'Nieprawidłowe dane logowania' })
    }
    const user = result.rows[0]
    if (!user.password_hash) {
      return res.status(401).json({ message: 'Nieprawidłowe dane logowania' })
    }
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) {
      return res.status(401).json({ message: 'Nieprawidłowe dane logowania' })
    }
    if (user.banned) {
      return res.status(403).json({ message: 'Konto zablokowane' })
    }
    const token = signToken({
      id: user.id,
      role: user.role,
      city: user.city,
      banned: user.banned,
    })
    return res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        city: user.city,
        rating: user.rating,
      },
    })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Błąd serwera' })
  }
})

app.get('/api/auth/me', authRequired, async (req, res) => {
  try {
    const result = await pool.query('select id, role, city, rating, banned from users where id = $1', [
      req.user.id,
    ])
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Użytkownik nie istnieje' })
    }
    return res.json({ user: result.rows[0] })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Błąd serwera' })
  }
})

app.post('/api/reports', authRequired, createReportLimiter, async (req, res) => {
  try {
    const { type, street, busNumber, direction, lat, lng } = req.body || {}
    if (!type || !['policja', 'kontrola'].includes(type)) {
      return res.status(400).json({ message: 'Nieprawidłowy typ zgłoszenia.' })
    }
    if (!street || typeof street !== 'string') {
      return res.status(400).json({ message: 'Ulica / przystanek jest wymagany.' })
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'Brak poprawnej lokalizacji na mapie.' })
    }

    const userId = req.user.id

    // blokada duplikatów w promieniu ~200m i 5 minut
    const duplicate = await pool.query(
      `
        select id from reports
        where city = $1
          and type = $2
          and created_at > now() - interval '5 minutes'
          and abs(lat - $3) < 0.002
          and abs(lng - $4) < 0.002
        limit 1
      `,
      [req.user.city, type, lat, lng],
    )
    if (duplicate.rowCount > 0) {
      return res.status(429).json({ message: 'Podobne zgłoszenie w okolicy zostało już dodane w ciągu ostatnich 5 minut.' })
    }

    const id = `rep_${crypto.randomUUID()}`
    const result = await pool.query(
      `
        insert into reports (id, city, type, street, bus_number, direction, lat, lng, user_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning *
      `,
      [id, req.user.city, type, street, busNumber || null, direction || null, lat, lng, userId],
    )

    return res.status(201).json({ report: result.rows[0] })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Błąd serwera' })
  }
})

app.get('/api/reports', authOptional, async (req, res) => {
  try {
    const sinceMinutes = Number.parseInt(req.query.sinceMinutes, 10) || 30
    const maxMinutes = sinceMinutes === 60 ? 60 : 30
    const city = req.query.city || req.user?.city
    if (!city) {
      return res.status(400).json({ message: 'Miasto jest wymagane.' })
    }
    const result = await pool.query(
      `
        select r.*, coalesce(count(c.user_id), 0) as confirmations_count
        from reports r
        left join confirmations c on c.report_id = r.id
        where r.city = $1
          and r.created_at > now() - ($2 || ' minutes')::interval
        group by r.id
        order by r.created_at desc
      `,
      [city, maxMinutes],
    )
    return res.json({ reports: result.rows })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Błąd serwera' })
  }
})

app.post('/api/reports/:id/confirm', authRequired, async (req, res) => {
  try {
    const reportId = req.params.id
    const userId = req.user.id

    const existing = await pool.query(
      'select 1 from confirmations where user_id = $1 and report_id = $2',
      [userId, reportId],
    )
    if (existing.rowCount > 0) {
      return res.status(400).json({ message: 'Już potwierdziłeś to zgłoszenie.' })
    }

    const reportResult = await pool.query('select user_id from reports where id = $1', [reportId])
    if (reportResult.rowCount === 0) {
      return res.status(404).json({ message: 'Zgłoszenie nie istnieje.' })
    }

    await pool.query('insert into confirmations (user_id, report_id) values ($1, $2)', [
      userId,
      reportId,
    ])

    await pool.query(
      'update users set rating = rating + 1 where id = $1',
      [reportResult.rows[0].user_id],
    )

    return res.json({ message: 'Potwierdzono zgłoszenie.' })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Błąd serwera' })
  }
})

// ADMIN

app.get('/api/admin/overview', authRequired, requireRole(['owner', 'moderator']), async (req, res) => {
  try {
    const [users, reports] = await Promise.all([
      pool.query('select id, role, city, rating, banned, created_at from users order by created_at desc limit 200'),
      pool.query('select * from reports order by created_at desc limit 200'),
    ])
    return res.json({ users: users.rows, reports: reports.rows })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Błąd serwera' })
  }
})

app.post(
  '/api/admin/users/:id/role',
  authRequired,
  requireRole(['owner']),
  async (req, res) => {
    try {
      const { role } = req.body || {}
      if (!['moderator', 'user'].includes(role)) {
        return res.status(400).json({ message: 'Nieprawidłowa rola.' })
      }
      await pool.query('update users set role = $1 where id = $2', [role, req.params.id])
      return res.json({ message: 'Zaktualizowano rolę użytkownika.' })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ message: 'Błąd serwera' })
    }
  },
)

app.post(
  '/api/admin/users/:id/ban',
  authRequired,
  requireRole(['owner', 'moderator']),
  async (req, res) => {
    try {
      const { banned } = req.body || {}
      await pool.query('update users set banned = $1 where id = $2', [
        Boolean(banned),
        req.params.id,
      ])
      return res.json({ message: 'Zaktualizowano status konta.' })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ message: 'Błąd serwera' })
    }
  },
)

app.delete(
  '/api/admin/reports/:id',
  authRequired,
  requireRole(['owner', 'moderator']),
  async (req, res) => {
    try {
      const report = await pool.query('select user_id from reports where id = $1', [
        req.params.id,
      ])
      if (report.rowCount === 0) {
        return res.status(404).json({ message: 'Zgłoszenie nie istnieje.' })
      }

      await pool.query('delete from reports where id = $1', [req.params.id])

      if (report.rows[0].user_id) {
        await pool.query('update users set rating = rating - 1 where id = $1', [
          report.rows[0].user_id,
        ])
      }

      return res.json({ message: 'Zgłoszenie zostało usunięte.' })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ message: 'Błąd serwera' })
    }
  },
)

app.post(
  '/api/admin/users/:id/reset-city',
  authRequired,
  requireRole(['owner', 'moderator']),
  async (req, res) => {
    try {
      await pool.query('update users set city = $1 where id = $2', ['DO_USTALENIA', req.params.id])
      return res.json({ message: 'Miasto zostało zresetowane. Użytkownik wybierze je ponownie przy następnym uruchomieniu.' })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ message: 'Błąd serwera' })
    }
  },
)

// sprzątanie zgłoszeń starszych niż 60 minut
cron.schedule('* * * * *', async () => {
  try {
    await pool.query("delete from reports where created_at < now() - interval '60 minutes'")
  } catch (e) {
    console.error('Błąd podczas czyszczenia zgłoszeń', e)
  }
})

// statyczne pliki i fallback
const distPath = path.join(__dirname, 'dist')
const indexHtml = path.join(distPath, 'index.html')

app.use(express.static(distPath))

app.get('*', (req, res) => {
  res.sendFile(indexHtml)
})

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MiastoAlert API działa na porcie ${PORT}`)
    })
  })
  .catch((e) => {
    console.error('Błąd inicjalizacji bazy danych', e)
    process.exit(1)
  })

