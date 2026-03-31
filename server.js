import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

app.use(cors());
app.use(express.json());

// Signup Endpoint
// Accepts: { email, password, firstName, lastName, dob }
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password, firstName, lastName, dob } = req.body;

        if (!email || !password || !firstName || !lastName || !dob) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                firstName,
                lastName,
                dob: new Date(dob),
            },
        });

        res.status(201).json({ message: 'User created successfully', userId: user.id });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login Endpoint
// Accepts: { email, password }
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

        res.status(200).json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Example protected route for testing
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { id: true, email: true, firstName: true, lastName: true, dob: true }
        });

        // Fetch last 5 sessions
        const recentSessions = await prisma.interaction.findMany({
            where: { userId: req.user.userId, kind: 'SESSION' },
            orderBy: { timestamp: 'desc' },
            take: 5
        });

        res.json({ ...user, recentSessions });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update Profile
app.put('/api/me', authenticateToken, async (req, res) => {
    try {
        const { firstName, lastName, dob } = req.body;
        const updatedUser = await prisma.user.update({
            where: { id: req.user.userId },
            data: {
                firstName,
                lastName,
                dob: new Date(dob)
            },
            select: { id: true, email: true, firstName: true, lastName: true, dob: true }
        });
        res.json(updatedUser);
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Record a Session
app.post('/api/sessions', authenticateToken, async (req, res) => {
    try {
        const { duration, articleId } = req.body; // Using a dummy articleId for schema compliance

        // Ensure dummy article exists for sessions
        const dummyArticleId = articleId || 'SESSION_DUMMY_ID';
        await prisma.article.upsert({
            where: { id: dummyArticleId },
            update: {},
            create: {
                id: dummyArticleId,
                title: 'Yoga Session',
                category: 'Session',
                embedding: []
            }
        });

        const interaction = await prisma.interaction.create({
            data: {
                userId: req.user.userId,
                articleId: dummyArticleId,
                kind: 'SESSION',
                duration: duration
            }
        });
        res.status(201).json(interaction);
    } catch (err) {
        console.error('Session record error:', err);
        res.status(500).json({ error: 'Failed to record session' });
    }
});

// Delete a single session by ID
app.delete('/api/sessions/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        // Ensure the session belongs to the requesting user
        const session = await prisma.interaction.findUnique({ where: { id } });
        if (!session || session.userId !== req.user.userId) {
            return res.status(404).json({ error: 'Session not found' });
        }
        await prisma.interaction.delete({ where: { id } });
        res.json({ message: 'Session deleted' });
    } catch (err) {
        console.error('Delete session error:', err);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

// Clear all sessions for the logged-in user
app.delete('/api/sessions', authenticateToken, async (req, res) => {
    try {
        await prisma.interaction.deleteMany({
            where: { userId: req.user.userId, kind: 'SESSION' }
        });
        res.json({ message: 'All sessions cleared' });
    } catch (err) {
        console.error('Clear sessions error:', err);
        res.status(500).json({ error: 'Failed to clear sessions' });
    }
});

const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// --- Exit Diagnostics ---
process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT (Ctrl+C). Preparing to exit...');
    server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM. Preparing to exit...');
    server.close(() => process.exit(0));
});
process.on('exit', (code) => {
    console.log(`ℹ️ Process exited with code: ${code}`);
});
process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});
