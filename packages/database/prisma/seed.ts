import { PrismaClient, UserRole } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seeding...')

  // =============================================================================
  // ROLES AND PERMISSIONS
  // =============================================================================
  
  console.log('📝 Creating roles and permissions...')
  
  // Create permissions
  const permissions = await Promise.all([
    // User permissions
    prisma.permission.upsert({
      where: { name: 'users:create' },
      update: {},
      create: {
        name: 'users:create',
        description: 'Create users',
        resource: 'users',
        action: 'create'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'users:read' },
      update: {},
      create: {
        name: 'users:read',
        description: 'Read users',
        resource: 'users',
        action: 'read'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'users:update' },
      update: {},
      create: {
        name: 'users:update',
        description: 'Update users',
        resource: 'users',
        action: 'update'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'users:delete' },
      update: {},
      create: {
        name: 'users:delete',
        description: 'Delete users',
        resource: 'users',
        action: 'delete'
      }
    }),
    
    // Post permissions
    prisma.permission.upsert({
      where: { name: 'posts:create' },
      update: {},
      create: {
        name: 'posts:create',
        description: 'Create posts',
        resource: 'posts',
        action: 'create'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'posts:read' },
      update: {},
      create: {
        name: 'posts:read',
        description: 'Read posts',
        resource: 'posts',
        action: 'read'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'posts:update' },
      update: {},
      create: {
        name: 'posts:update',
        description: 'Update posts',
        resource: 'posts',
        action: 'update'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'posts:delete' },
      update: {},
      create: {
        name: 'posts:delete',
        description: 'Delete posts',
        resource: 'posts',
        action: 'delete'
      }
    }),
    
    // Media permissions
    prisma.permission.upsert({
      where: { name: 'media:create' },
      update: {},
      create: {
        name: 'media:create',
        description: 'Upload media',
        resource: 'media',
        action: 'create'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'media:read' },
      update: {},
      create: {
        name: 'media:read',
        description: 'View media',
        resource: 'media',
        action: 'read'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'media:update' },
      update: {},
      create: {
        name: 'media:update',
        description: 'Update media',
        resource: 'media',
        action: 'update'
      }
    }),
    prisma.permission.upsert({
      where: { name: 'media:delete' },
      update: {},
      create: {
        name: 'media:delete',
        description: 'Delete media',
        resource: 'media',
        action: 'delete'
      }
    })
  ])

  // Create roles
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'Super Admin' },
    update: {},
    create: {
      name: 'Super Admin',
      description: 'Full system access',
      permissions: {
        connect: permissions.map(p => ({ id: p.id }))
      }
    }
  })

  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    create: {
      name: 'Admin',
      description: 'Administrative access',
      permissions: {
        connect: permissions.filter(p => 
          !p.name.includes('users:delete')
        ).map(p => ({ id: p.id }))
      }
    }
  })

  const editorRole = await prisma.role.upsert({
    where: { name: 'Editor' },
    update: {},
    create: {
      name: 'Editor',
      description: 'Content editing access',
      permissions: {
        connect: permissions.filter(p => 
          p.resource === 'posts' || p.resource === 'media'
        ).map(p => ({ id: p.id }))
      }
    }
  })

  const authorRole = await prisma.role.upsert({
    where: { name: 'Author' },
    update: {},
    create: {
      name: 'Author',
      description: 'Content creation access',
      permissions: {
        connect: permissions.filter(p => 
          (p.resource === 'posts' && !p.name.includes('delete')) ||
          (p.resource === 'media' && !p.name.includes('delete'))
        ).map(p => ({ id: p.id }))
      }
    }
  })

  // =============================================================================
  // USERS
  // =============================================================================
  
  console.log('👤 Creating users...')
  
  const hashedPassword = await bcrypt.hash('admin123', 12)
  
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@cms-platform.com' },
    update: {},
    create: {
      email: 'admin@cms-platform.com',
      username: 'superadmin',
      firstName: 'Super',
      lastName: 'Admin',
      password: hashedPassword,
      role: UserRole.SUPER_ADMIN,
      roleId: superAdminRole.id,
      isActive: true,
      emailVerified: new Date()
    }
  })

  const admin = await prisma.user.upsert({
    where: { email: 'admin2@cms-platform.com' },
    update: {},
    create: {
      email: 'admin2@cms-platform.com',
      username: 'admin',
      firstName: 'Admin',
      lastName: 'User',
      password: hashedPassword,
      role: UserRole.ADMIN,
      roleId: adminRole.id,
      isActive: true,
      emailVerified: new Date()
    }
  })

  const editor = await prisma.user.upsert({
    where: { email: 'editor@cms-platform.com' },
    update: {},
    create: {
      email: 'editor@cms-platform.com',
      username: 'editor',
      firstName: 'Editor',
      lastName: 'User',
      password: hashedPassword,
      role: UserRole.EDITOR,
      roleId: editorRole.id,
      isActive: true,
      emailVerified: new Date()
    }
  })

  const author = await prisma.user.upsert({
    where: { email: 'author@cms-platform.com' },
    update: {},
    create: {
      email: 'author@cms-platform.com',
      username: 'author',
      firstName: 'Author',
      lastName: 'User',
      password: hashedPassword,
      role: UserRole.AUTHOR,
      roleId: authorRole.id,
      isActive: true,
      emailVerified: new Date()
    }
  })

  // =============================================================================
  // CATEGORIES
  // =============================================================================
  
  console.log('📂 Creating categories...')
  
  const techCategory = await prisma.category.upsert({
    where: { slug: 'technology' },
    update: {},
    create: {
      name: 'Technology',
      slug: 'technology',
      description: 'Technology related posts',
      color: '#3B82F6',
      icon: '💻',
      metaTitle: 'Technology Articles',
      metaDescription: 'Latest technology news and articles',
      isVisible: true,
      sortOrder: 1,
      userId: superAdmin.id
    }
  })

  const businessCategory = await prisma.category.upsert({
    where: { slug: 'business' },
    update: {},
    create: {
      name: 'Business',
      slug: 'business',
      description: 'Business and entrepreneurship',
      color: '#10B981',
      icon: '💼',
      metaTitle: 'Business Articles',
      metaDescription: 'Business insights and entrepreneurship tips',
      isVisible: true,
      sortOrder: 2,
      userId: superAdmin.id
    }
  })

  const lifestyleCategory = await prisma.category.upsert({
    where: { slug: 'lifestyle' },
    update: {},
    create: {
      name: 'Lifestyle',
      slug: 'lifestyle',
      description: 'Lifestyle and personal development',
      color: '#F59E0B',
      icon: '🌟',
      metaTitle: 'Lifestyle Articles',
      metaDescription: 'Lifestyle tips and personal development',
      isVisible: true,
      sortOrder: 3,
      userId: superAdmin.id
    }
  })

  // =============================================================================
  // TAGS
  // =============================================================================
  
  console.log('🏷️ Creating tags...')
  
  const tags = await Promise.all([
    prisma.tag.upsert({
      where: { slug: 'javascript' },
      update: {},
      create: {
        name: 'JavaScript',
        slug: 'javascript',
        description: 'JavaScript programming language',
        color: '#F7DF1E',
        userId: superAdmin.id
      }
    }),
    prisma.tag.upsert({
      where: { slug: 'react' },
      update: {},
      create: {
        name: 'React',
        slug: 'react',
        description: 'React JavaScript library',
        color: '#61DAFB',
        userId: superAdmin.id
      }
    }),
    prisma.tag.upsert({
      where: { slug: 'nodejs' },
      update: {},
      create: {
        name: 'Node.js',
        slug: 'nodejs',
        description: 'Node.js runtime environment',
        color: '#339933',
        userId: superAdmin.id
      }
    }),
    prisma.tag.upsert({
      where: { slug: 'startup' },
      update: {},
      create: {
        name: 'Startup',
        slug: 'startup',
        description: 'Startup and entrepreneurship',
        color: '#8B5CF6',
        userId: superAdmin.id
      }
    }),
    prisma.tag.upsert({
      where: { slug: 'productivity' },
      update: {},
      create: {
        name: 'Productivity',
        slug: 'productivity',
        description: 'Productivity tips and tools',
        color: '#EF4444',
        userId: superAdmin.id
      }
    })
  ])

  // =============================================================================
  // POSTS
  // =============================================================================
  
  console.log('📝 Creating sample posts...')
  
  const post1 = await prisma.post.upsert({
    where: { slug: 'welcome-to-cms-platform' },
    update: {},
    create: {
      title: 'Welcome to CMS Platform',
      slug: 'welcome-to-cms-platform',
      excerpt: 'Welcome to our new enterprise CMS platform built with Next.js and Node.js',
      content: `# Welcome to CMS Platform

This is our new enterprise-grade Content Management System built with modern technologies:

- **Frontend**: Next.js 15 with React 19
- **Backend**: Node.js with Express and tRPC
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with role-based access control
- **Real-time**: WebSocket support for live updates

## Features

- 🚀 **High Performance**: Built for speed and scalability
- 🔒 **Secure**: Enterprise-grade security features
- 📱 **Responsive**: Mobile-first design approach
- 🎨 **Customizable**: Flexible theming and customization
- 📊 **Analytics**: Built-in analytics and reporting

Get started by exploring the admin dashboard and creating your first content!`,
      status: 'PUBLISHED',
      type: 'POST',
      metaTitle: 'Welcome to CMS Platform - Getting Started',
      metaDescription: 'Learn about our new enterprise CMS platform and its features',
      publishedAt: new Date(),
      isFeatured: true,
      authorId: superAdmin.id,
      categories: {
        connect: [{ id: techCategory.id }]
      },
      tags: {
        connect: [
          { id: tags[0].id }, // JavaScript
          { id: tags[1].id }  // React
        ]
      }
    }
  })

  // =============================================================================
  // SETTINGS
  // =============================================================================
  
  console.log('⚙️ Creating system settings...')
  
  await Promise.all([
    prisma.setting.upsert({
      where: { key: 'site_title' },
      update: {},
      create: {
        key: 'site_title',
        value: 'CMS Platform',
        type: 'STRING',
        group: 'general',
        description: 'Site title displayed in browser tab',
        isPublic: true
      }
    }),
    prisma.setting.upsert({
      where: { key: 'site_description' },
      update: {},
      create: {
        key: 'site_description',
        value: 'Enterprise-grade Content Management System',
        type: 'TEXT',
        group: 'general',
        description: 'Site description for SEO',
        isPublic: true
      }
    }),
    prisma.setting.upsert({
      where: { key: 'posts_per_page' },
      update: {},
      create: {
        key: 'posts_per_page',
        value: '10',
        type: 'NUMBER',
        group: 'content',
        description: 'Number of posts to display per page',
        isPublic: true
      }
    }),
    prisma.setting.upsert({
      where: { key: 'allow_comments' },
      update: {},
      create: {
        key: 'allow_comments',
        value: 'true',
        type: 'BOOLEAN',
        group: 'content',
        description: 'Allow comments on posts',
        isPublic: true
      }
    }),
    prisma.setting.upsert({
      where: { key: 'maintenance_mode' },
      update: {},
      create: {
        key: 'maintenance_mode',
        value: 'false',
        type: 'BOOLEAN',
        group: 'system',
        description: 'Enable maintenance mode',
        isPublic: false
      }
    })
  ])

  console.log('✅ Database seeding completed successfully!')
  console.log(`
📊 Seeding Summary:
- 👤 Users: 4 (Super Admin, Admin, Editor, Author)
- 🔐 Roles: 4 with permissions
- 📂 Categories: 3 (Technology, Business, Lifestyle)
- 🏷️ Tags: 5 (JavaScript, React, Node.js, Startup, Productivity)
- 📝 Posts: 1 (Welcome post)
- ⚙️ Settings: 5 system settings

🔑 Login Credentials:
- Super Admin: admin@cms-platform.com / admin123
- Admin: admin2@cms-platform.com / admin123
- Editor: editor@cms-platform.com / admin123
- Author: author@cms-platform.com / admin123
  `)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
