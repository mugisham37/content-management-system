import nodemailer, { Transporter } from "nodemailer"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"

export interface EmailServiceOptions {
  smtp: {
    host: string
    port: number
    secure: boolean
    auth: {
      user: string
      pass: string
    }
  }
  from: {
    name: string
    email: string
  }
  enableAudit?: boolean
  enableTemplates?: boolean
  enableQueue?: boolean
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  htmlTemplate: string
  textTemplate?: string
  variables: string[]
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface EmailOptions {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  subject: string
  html?: string
  text?: string
  attachments?: Array<{
    filename: string
    content: Buffer | string
    contentType?: string
    cid?: string
  }>
  template?: {
    id: string
    variables: Record<string, any>
  }
  priority?: "high" | "normal" | "low"
  replyTo?: string
  headers?: Record<string, string>
}

export interface EmailStats {
  totalSent: number
  totalFailed: number
  totalQueued: number
  recentActivity: Array<{
    id: string
    to: string
    subject: string
    status: string
    timestamp: Date
  }>
  topTemplates: Array<{
    templateId: string
    name: string
    usageCount: number
  }>
}

export class EmailService {
  private transporter!: Transporter
  private options: EmailServiceOptions
  private templates: Map<string, EmailTemplate> = new Map()
  private emailQueue: Array<{ id: string; options: EmailOptions; retries: number }> = []
  private isProcessingQueue = false

  constructor(options: EmailServiceOptions) {
    this.options = {
      enableAudit: true,
      enableTemplates: true,
      enableQueue: true,
      ...options,
    }

    this.initializeTransporter()
    this.loadTemplates()

    if (this.options.enableQueue) {
      this.startQueueProcessor()
    }

    logger.info("Email service initialized", {
      host: this.options.smtp.host,
      port: this.options.smtp.port,
      enableTemplates: this.options.enableTemplates,
      enableQueue: this.options.enableQueue,
    })
  }

  /**
   * Initialize nodemailer transporter
   */
  private initializeTransporter(): void {
    try {
      this.transporter = nodemailer.createTransport({
        host: this.options.smtp.host,
        port: this.options.smtp.port,
        secure: this.options.smtp.secure,
        auth: {
          user: this.options.smtp.auth.user,
          pass: this.options.smtp.auth.pass,
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 10,
      })

      // Verify connection
      this.transporter.verify((error) => {
        if (error) {
          logger.error("SMTP connection verification failed:", error)
        } else {
          logger.info("SMTP connection verified successfully")
        }
      })
    } catch (error) {
      logger.error("Failed to initialize email transporter:", error)
      throw error
    }
  }

  /**
   * Load email templates
   */
  private async loadTemplates(): Promise<void> {
    if (!this.options.enableTemplates) return

    try {
      // In a real implementation, this would load from database
      // For now, we'll add some default templates
      const defaultTemplates: EmailTemplate[] = [
        {
          id: "welcome",
          name: "Welcome Email",
          subject: "Welcome to {{appName}}!",
          htmlTemplate: `
            <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
              <h1>Welcome {{firstName}}!</h1>
              <p>Thank you for joining {{appName}}. We're excited to have you on board.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{{dashboardUrl}}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                  Get Started
                </a>
              </div>
              <p>If you have any questions, feel free to contact our support team.</p>
              <p>Best regards,<br>The {{appName}} Team</p>
            </div>
          `,
          textTemplate: "Welcome {{firstName}}! Thank you for joining {{appName}}.",
          variables: ["firstName", "appName", "dashboardUrl"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "password-reset",
          name: "Password Reset",
          subject: "Reset your password",
          htmlTemplate: `
            <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
              <h1>Reset Your Password</h1>
              <p>You requested to reset your password. Click the button below to set a new password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{{resetUrl}}" style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                  Reset Password
                </a>
              </div>
              <p>This link will expire in {{expiryMinutes}} minutes.</p>
              <p>If you didn't request a password reset, you can safely ignore this email.</p>
            </div>
          `,
          textTemplate: "Reset your password by visiting: {{resetUrl}}",
          variables: ["resetUrl", "expiryMinutes"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "email-verification",
          name: "Email Verification",
          subject: "Verify your email address",
          htmlTemplate: `
            <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
              <h1>Verify Your Email</h1>
              <p>Please click the button below to verify your email address:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{{verificationUrl}}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                  Verify Email
                </a>
              </div>
              <p>This link will expire in {{expiryHours}} hours.</p>
              <p>If you didn't create an account, you can safely ignore this email.</p>
            </div>
          `,
          textTemplate: "Verify your email by visiting: {{verificationUrl}}",
          variables: ["verificationUrl", "expiryHours"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      for (const template of defaultTemplates) {
        this.templates.set(template.id, template)
      }

      logger.info(`Loaded ${defaultTemplates.length} email templates`)
    } catch (error) {
      logger.error("Failed to load email templates:", error)
    }
  }

  /**
   * Send email
   */
  async sendEmail(
    options: EmailOptions,
    userId?: string,
    tenantId?: string,
    immediate = false
  ): Promise<{ messageId: string; queued?: boolean }> {
    try {
      // Validate email options
      this.validateEmailOptions(options)

      // Process template if specified
      if (options.template) {
        const processedTemplate = await this.processTemplate(options.template.id, options.template.variables)
        options.subject = processedTemplate.subject
        options.html = processedTemplate.html
        options.text = processedTemplate.text
      }

      // If queue is enabled and not immediate, add to queue
      if (this.options.enableQueue && !immediate) {
        const emailId = this.generateEmailId()
        this.emailQueue.push({
          id: emailId,
          options,
          retries: 0,
        })

        logger.info("Email queued", {
          id: emailId,
          to: options.to,
          subject: options.subject,
          userId,
          tenantId,
        })

        return { messageId: emailId, queued: true }
      }

      // Send immediately
      const result = await this.sendEmailImmediate(options)

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "email.send",
          entityType: "Email",
          entityId: result.messageId,
          userId,
          details: {
            to: options.to,
            subject: options.subject,
            template: options.template?.id,
            immediate,
          },
        })
      }

      logger.info("Email sent", {
        messageId: result.messageId,
        to: options.to,
        subject: options.subject,
        userId,
        tenantId,
      })

      return result
    } catch (error) {
      logger.error("Failed to send email:", error)
      throw error
    }
  }

  /**
   * Send email immediately
   */
  private async sendEmailImmediate(options: EmailOptions): Promise<{ messageId: string }> {
    try {
      const mailOptions = {
        from: `${this.options.from.name} <${this.options.from.email}>`,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(", ") : options.cc) : undefined,
        bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc.join(", ") : options.bcc) : undefined,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
        replyTo: options.replyTo,
        headers: options.headers,
        priority: options.priority || "normal",
      }

      const result = await this.transporter.sendMail(mailOptions)
      return { messageId: result.messageId }
    } catch (error) {
      logger.error("Failed to send email immediately:", error)
      throw error
    }
  }

  /**
   * Process email template
   */
  private async processTemplate(
    templateId: string,
    variables: Record<string, any>
  ): Promise<{ subject: string; html: string; text?: string }> {
    try {
      const template = this.templates.get(templateId)
      if (!template) {
        throw ApiError.notFound(`Email template '${templateId}' not found`)
      }

      if (!template.isActive) {
        throw ApiError.badRequest(`Email template '${templateId}' is not active`)
      }

      // Replace variables in subject
      let subject = template.subject
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, "g")
        subject = subject.replace(regex, String(value))
      }

      // Replace variables in HTML template
      let html = template.htmlTemplate
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, "g")
        html = html.replace(regex, String(value))
      }

      // Replace variables in text template
      let text: string | undefined
      if (template.textTemplate) {
        text = template.textTemplate
        for (const [key, value] of Object.entries(variables)) {
          const regex = new RegExp(`{{${key}}}`, "g")
          text = text.replace(regex, String(value))
        }
      }

      return { subject, html, text }
    } catch (error) {
      logger.error("Failed to process email template:", error)
      throw error
    }
  }

  /**
   * Validate email options
   */
  private validateEmailOptions(options: EmailOptions): void {
    const errors: string[] = []

    if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
      errors.push("Recipient email address is required")
    }

    if (!options.subject || options.subject.trim().length === 0) {
      errors.push("Email subject is required")
    }

    if (!options.html && !options.text && !options.template) {
      errors.push("Email content (html, text, or template) is required")
    }

    // Validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const validateEmails = (emails: string | string[]) => {
      const emailList = Array.isArray(emails) ? emails : [emails]
      for (const email of emailList) {
        if (!emailRegex.test(email)) {
          errors.push(`Invalid email address: ${email}`)
        }
      }
    }

    if (options.to) validateEmails(options.to)
    if (options.cc) validateEmails(options.cc)
    if (options.bcc) validateEmails(options.bcc)
    if (options.replyTo) validateEmails(options.replyTo)

    if (errors.length > 0) {
      throw ApiError.validationError("Email validation failed", errors)
    }
  }

  /**
   * Start queue processor
   */
  private startQueueProcessor(): void {
    if (this.isProcessingQueue) return

    this.isProcessingQueue = true

    const processQueue = async () => {
      while (this.emailQueue.length > 0) {
        const emailItem = this.emailQueue.shift()
        if (!emailItem) continue

        try {
          await this.sendEmailImmediate(emailItem.options)
          logger.debug("Queued email sent successfully", { id: emailItem.id })
        } catch (error) {
          logger.error("Failed to send queued email:", error)

          // Retry logic
          if (emailItem.retries < 3) {
            emailItem.retries++
            this.emailQueue.push(emailItem)
            logger.info("Email queued for retry", {
              id: emailItem.id,
              retries: emailItem.retries,
            })
          } else {
            logger.error("Email failed after max retries", {
              id: emailItem.id,
              retries: emailItem.retries,
            })
          }
        }

        // Wait between emails to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Check queue again after 5 seconds
      setTimeout(processQueue, 5000)
    }

    processQueue()
  }

  /**
   * Generate unique email ID
   */
  private generateEmailId(): string {
    return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get email template
   */
  async getTemplate(templateId: string): Promise<EmailTemplate | null> {
    return this.templates.get(templateId) || null
  }

  /**
   * Create email template
   */
  async createTemplate(template: Omit<EmailTemplate, "id" | "createdAt" | "updatedAt">): Promise<EmailTemplate> {
    try {
      const newTemplate: EmailTemplate = {
        ...template,
        id: this.generateTemplateId(template.name),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      this.templates.set(newTemplate.id, newTemplate)

      logger.info("Email template created", {
        id: newTemplate.id,
        name: newTemplate.name,
      })

      return newTemplate
    } catch (error) {
      logger.error("Failed to create email template:", error)
      throw error
    }
  }

  /**
   * Update email template
   */
  async updateTemplate(
    templateId: string,
    updates: Partial<Omit<EmailTemplate, "id" | "createdAt" | "updatedAt">>
  ): Promise<EmailTemplate> {
    try {
      const template = this.templates.get(templateId)
      if (!template) {
        throw ApiError.notFound(`Email template '${templateId}' not found`)
      }

      const updatedTemplate: EmailTemplate = {
        ...template,
        ...updates,
        updatedAt: new Date(),
      }

      this.templates.set(templateId, updatedTemplate)

      logger.info("Email template updated", {
        id: templateId,
        name: updatedTemplate.name,
      })

      return updatedTemplate
    } catch (error) {
      logger.error("Failed to update email template:", error)
      throw error
    }
  }

  /**
   * Delete email template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    try {
      const template = this.templates.get(templateId)
      if (!template) {
        throw ApiError.notFound(`Email template '${templateId}' not found`)
      }

      this.templates.delete(templateId)

      logger.info("Email template deleted", {
        id: templateId,
        name: template.name,
      })
    } catch (error) {
      logger.error("Failed to delete email template:", error)
      throw error
    }
  }

  /**
   * List email templates
   */
  async listTemplates(): Promise<EmailTemplate[]> {
    return Array.from(this.templates.values())
  }

  /**
   * Generate template ID
   */
  private generateTemplateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim()
  }

  /**
   * Get email statistics
   */
  async getStats(): Promise<EmailStats> {
    try {
      // In a real implementation, this would query from database
      // For now, return mock data
      return {
        totalSent: 0,
        totalFailed: 0,
        totalQueued: this.emailQueue.length,
        recentActivity: [],
        topTemplates: [],
      }
    } catch (error) {
      logger.error("Failed to get email stats:", error)
      throw error
    }
  }

  /**
   * Test email configuration
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.transporter.verify()
      return {
        success: true,
        message: "Email configuration is valid and connection successful",
      }
    } catch (error) {
      logger.error("Email connection test failed:", error)
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection test failed",
      }
    }
  }

  /**
   * Send test email
   */
  async sendTestEmail(to: string, userId?: string): Promise<{ messageId: string }> {
    try {
      const testOptions: EmailOptions = {
        to,
        subject: "Test Email from CMS",
        html: `
          <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
            <h1>Test Email</h1>
            <p>This is a test email from your CMS email service.</p>
            <p>If you received this email, your email configuration is working correctly.</p>
            <p>Sent at: ${new Date().toISOString()}</p>
          </div>
        `,
        text: `Test Email - This is a test email from your CMS email service. Sent at: ${new Date().toISOString()}`,
      }

      return await this.sendEmail(testOptions, userId, undefined, true)
    } catch (error) {
      logger.error("Failed to send test email:", error)
      throw error
    }
  }

  /**
   * Clear email queue
   */
  clearQueue(): void {
    const queueLength = this.emailQueue.length
    this.emailQueue = []
    logger.info(`Cleared email queue (${queueLength} emails removed)`)
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { length: number; isProcessing: boolean } {
    return {
      length: this.emailQueue.length,
      isProcessing: this.isProcessingQueue,
    }
  }
}

// Export singleton instance (will be initialized with config)
export let emailService: EmailService

export const initializeEmailService = (options: EmailServiceOptions): void => {
  emailService = new EmailService(options)
}
