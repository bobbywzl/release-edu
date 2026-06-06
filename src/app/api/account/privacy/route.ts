import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

const PRIVACY_FILE = path.join(process.cwd(), 'prisma', 'privacy-settings.json')

function loadSettings() {
  try {
    if (fs.existsSync(PRIVACY_FILE)) {
      return JSON.parse(fs.readFileSync(PRIVACY_FILE, 'utf8'))
    }
  } catch { /* ignore */ }
  return {
    profileVisible: true,
    showProgress: true,
    showStreak: true,
    showProjects: false,
    allowMentorView: true,
    allowParentView: true,
    shareAnalytics: false,
    aiDataTraining: false,
  }
}

function saveSettings(settings: Record<string, boolean>) {
  try {
    fs.writeFileSync(PRIVACY_FILE, JSON.stringify(settings, null, 2), 'utf8')
  } catch { /* ignore */ }
}

export async function GET() {
  return NextResponse.json({ settings: loadSettings() })
}

export async function POST(request: Request) {
  try {
    const settings = await request.json()
    saveSettings(settings)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save privacy settings' }, { status: 500 })
  }
}
