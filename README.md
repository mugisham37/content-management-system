# 🚀 Enterprise CMS Platform

A modern, scalable Content Management System built with Next.js, Node.js, PostgreSQL, and Redis. This monorepo architecture provides the perfect foundation for enterprise-grade CMS development with optimal developer experience and production-ready features.

## 🏗️ Architecture Overview

This project uses a **monorepo architecture** with **Turborepo** for optimal development workflow and deployment efficiency:

```
cms-platform/
├── 📁 apps/                    # Applications
│   ├── 📁 client/              # Next.js Frontend (Port 3000)
│   └── 📁 server/              # Node.js Backend (Port 8000)
├── 📁 packages/                # Shared Packages
│   ├── 📁 database/            # Prisma Database Layer
│   ├── 📁 shared/              # Shared Types & Utilities
│   └── 📁 ui/                  # Shared UI Components
└── 📁 tools/                   # Development Tools
```

## ✨ Key Features

### 🎯 **Perfect Git Integration**
- **Monorepo Structure**: Single repository tracks both frontend and backend
- **Commit from Anywhere**: Git aliases allow committing from any directory
- **Atomic Changes**: Frontend and backend changes in single commits

### 🔧 **Modern Tech Stack**
- **Frontend**: Next.js 14+ with App Router, TypeScript, Tailwind CSS
- **Backend**: Node.js with Express, TypeScript, Prisma ORM
- **Database**: PostgreSQL with Redis caching
- **Monorepo**: Turborepo with PNPM workspaces

### 🛡️ **Enterprise Security**
- JWT Authentication with refresh tokens
- Rate limiting and CORS protection
- Helmet.js security headers
- Input validation with Zod
- SQL injection protection with Prisma

### 🚀 **DevOps Ready**
- Docker containerization with multi-stage builds
- GitHub Actions CI/CD pipeline
- Health checks and monitoring
- Graceful shutdown handling
- Comprehensive logging

### 📊 **Performance Optimized**
- Redis caching layer
- Database query optimization
- Image optimization and CDN ready
- Compression and minification
- Response time monitoring

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **PNPM** 8+
- **Docker** & **Docker Compose**
- **PostgreSQL** 15+ (or use Docker)

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/your-username/cms-platform.git
cd cms-platform

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Setup database with Docker
docker-compose up postgres redis -d

# Generate Prisma client and run migrations
pnpm run db:generate
pnpm run db:migrate

# Seed the database (optional)
pnpm run db:seed
```

### 2. Development

```bash
# Start all services
pnpm run dev

# Or start individually
pnpm run dev:client    # Frontend only
pnpm run dev:server    # Backend only
pnpm run dev:db        # Database only
```

**Access Points:**
- 🌐 **Frontend**: http://localhost:3000
- 🔧 **Backend API**: http://localhost:8000
- 🏥 **Health Check**: http://localhost:8000/health
- 🗄️ **Database Admin**: http://localhost:5050 (pgAdmin)
- 📊 **Redis Admin**: http://localhost:8001 (RedisInsight)

### 3. Production Deployment

```bash
# Build all applications
pnpm run build

# Start with Docker Compose
docker-compose up --build

# Or deploy to cloud (see deployment section)
```

## 📁 Project Structure

### Frontend (`apps/client/`)
```
client/
├── 📁 src/app/                 # Next.js App Router
│   ├── 📄 layout.tsx           # Root layout
│   ├── 📄 page.tsx             # Home page
│   ├── 📁 (dashboard)/         # Dashboard routes
│   ├── 📁 (auth)/              # Auth routes
│   └── 📁 api/                 # API routes
├── 📁 src/components/          # React components
├── 📁 src/hooks/               # Custom hooks
├── 📁 src/lib/                 # Client utilities
├── 📁 src/store/               # State management
└── 📁 src/types/               # TypeScript types
```

### Backend (`apps/server/`)
```
server/
├── 📁 src/config/              # Configuration
├── 📁 src/controllers/         # Request controllers
├── 📁 src/middleware/          # Express middleware
├── 📁 src/routes/              # API routes
├── 📁 src/services/            # Business logic
├── 📁 src/utils/               # Utilities
└── 📁 src/types/               # TypeScript types
```

### Database (`packages/database/`)
```
database/
├── 📁 prisma/                  # Prisma configuration
│   ├── 📄 schema.prisma        # Database schema
│   └── 📁 migrations/          # Database migrations
└── 📁 src/                     # Database utilities
```

## 🔧 Development Workflow

### Git Workflow
```bash
# Commit from anywhere in the project
git add .
git commit -m "feat: add new feature"
git push

# Or use aliases (configured automatically)
git ca "feat: add new feature"  # commit all
git ps                          # push
```

### Database Operations
```bash
# Generate Prisma client
pnpm run db:generate

# Create and apply migration
pnpm run db:migrate

# Push schema changes (development)
pnpm run db:push

# Open Prisma Studio
pnpm run db:studio

# Reset database
pnpm run db:reset
```

### Testing
```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm run test:coverage

# Run specific test suite
pnpm run test --filter=cms-server
```

### Building
```bash
# Build all applications
pnpm run build

# Build specific application
pnpm run build --filter=cms-client
pnpm run build --filter=cms-server

# Type check all packages
pnpm run type-check

# Lint all packages
pnpm run lint
```

## 🌐 API Documentation

### Authentication Endpoints
```
POST   /api/v1/auth/register     # User registration
POST   /api/v1/auth/login        # User login
POST   /api/v1/auth/refresh      # Refresh token
POST   /api/v1/auth/logout       # User logout
GET    /api/v1/auth/me           # Get current user
```

### Content Management
```
GET    /api/v1/posts             # Get all posts
POST   /api/v1/posts             # Create post
GET    /api/v1/posts/:id         # Get post by ID
PUT    /api/v1/posts/:id         # Update post
DELETE /api/v1/posts/:id         # Delete post
```

### Media Management
```
POST   /api/v1/media/upload      # Upload media
GET    /api/v1/media             # Get media files
DELETE /api/v1/media/:id         # Delete media
```

## 🐳 Docker Deployment

### Development
```bash
# Start all services
docker-compose up

# Start specific services
docker-compose up postgres redis
docker-compose up server client
```

### Production
```bash
# Build and start production containers
docker-compose -f docker-compose.prod.yml up --build

# Scale services
docker-compose up --scale server=3 --scale client=2
```

## 🔒 Environment Variables

### Required Variables
```env
# Database
DATABASE_URL="postgresql://cms_user:cms_password@localhost:5432/cms_db"

# JWT
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="7d"

# Redis
REDIS_URL="redis://localhost:6379"

# API
API_PORT=8000
CORS_ORIGIN="http://localhost:3000"

# Frontend
NEXT_PUBLIC_API_URL="http://localhost:8000"
```

### Optional Variables
```env
# Email
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"

# File Upload
MAX_FILE_SIZE="10mb"
UPLOAD_DIR="./uploads"

# Monitoring
LOG_LEVEL="info"
HEALTH_CHECK_ENABLED="true"
```

## 📊 Monitoring & Logging

### Health Checks
- **Basic**: `GET /health`
- **Detailed**: `GET /api/health/detailed`
- **Database**: Automatic connection testing
- **Redis**: Cache connectivity verification

### Logging
- **Winston** for structured logging
- **Morgan** for HTTP request logging
- **File rotation** for production logs
- **Console output** for development

### Metrics
- Response time tracking
- Error rate monitoring
- Database query performance
- Memory usage tracking

## 🚀 Deployment Options

### 1. Docker Compose (Recommended)
```bash
docker-compose up --build -d
```

### 2. Kubernetes
```bash
kubectl apply -f k8s/
```

### 3. Cloud Platforms
- **Vercel** (Frontend)
- **Railway/Render** (Backend)
- **AWS/GCP/Azure** (Full stack)

## 🔧 Configuration

### Turborepo Configuration
The `turbo.json` file configures build pipelines and caching:

```json
{
  "pipeline": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

### PNPM Workspaces
The `pnpm-workspace.yaml` defines package structure:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'feat: add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines
- Follow **TypeScript** best practices
- Write **tests** for new features
- Update **documentation** as needed
- Follow **conventional commits**

## 📝 Scripts Reference

### Root Level Scripts
```bash
pnpm run dev          # Start all applications
pnpm run build        # Build all applications
pnpm run test         # Run all tests
pnpm run lint         # Lint all packages
pnpm run type-check   # Type check all packages
pnpm run clean        # Clean all build artifacts
```

### Database Scripts
```bash
pnpm run db:generate  # Generate Prisma client
pnpm run db:migrate   # Run migrations
pnpm run db:push      # Push schema changes
pnpm run db:studio    # Open Prisma Studio
pnpm run db:seed      # Seed database
pnpm run db:reset     # Reset database
```

## 🐛 Troubleshooting

### Common Issues

**Port Already in Use**
```bash
# Kill process on port
npx kill-port 3000
npx kill-port 8000
```

**Database Connection Issues**
```bash
# Reset database container
docker-compose down postgres
docker-compose up postgres -d
```

**PNPM Installation Issues**
```bash
# Clear PNPM cache
pnpm store prune
rm -rf node_modules
pnpm install
```

**TypeScript Errors**
```bash
# Regenerate Prisma client
pnpm run db:generate
# Restart TypeScript server in VS Code
```

## 📚 Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [Docker Documentation](https://docs.docker.com)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Next.js** team for the amazing framework
- **Prisma** team for the excellent ORM
- **Vercel** team for Turborepo
- **Community** contributors and maintainers

---

**Built with ❤️ for modern web development**

For questions or support, please open an issue or contact the maintainers.
