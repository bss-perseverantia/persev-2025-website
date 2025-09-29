// routes/registration.js
const express = require('express');
// const mongoose = require('mongoose'); // no longer used with SQLite
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dbModels = require('../database/init_db'); // SQLite init (same filename)
const googleSheetsService = require('../services/googleSheets');

const { initializeDatabase } = dbModels; // ensure initialized at app startup
const router = express.Router();

// Convenience getter each time so we don't capture a null before init
const db = () => dbModels.db();

// Load school configuration and create user-to-school mapping
let userSchoolMapping = {};
let schoolConfig = null;

function loadSchoolConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'school_config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    schoolConfig = JSON.parse(configData);

    // Create user-to-school mapping from config
    userSchoolMapping = {};
    schoolConfig.schools.forEach((school) => {
      userSchoolMapping[school.username] = school.schoolName;
    });

    console.log('School configuration loaded successfully');
  } catch (error) {
    console.error('Error loading school configuration:', error);
    // Fallback to empty mapping if config fails to load
    userSchoolMapping = {};
  }
}

// Load configuration on startup
loadSchoolConfig();

// ---------- helpers over SQLite schema ----------

function findSchoolByName(name) {
  return db()
    .prepare('SELECT * FROM schools WHERE name = ?')
    .get(name);
}

function findSchoolById(id) {
  return db()
    .prepare('SELECT * FROM schools WHERE id = ?')
    .get(id);
}

function upsertSchool(schoolData) {
  const existing = findSchoolByName(schoolData.name);
  if (existing) {
    db()
      .prepare(
        `UPDATE schools
         SET contingent_code = COALESCE(?, contingent_code),
             teacher_name = ?,
             teacher_mobile = ?,
             teacher_email = ?
         WHERE id = ?`
      )
      .run(
        schoolData.contingentCode ?? null,
        schoolData.teacherName,
        schoolData.teacherMobile,
        schoolData.teacherEmail,
        existing.id
      );
    return findSchoolById(existing.id);
  } else {
    const info = db()
      .prepare(
        `INSERT INTO schools
         (name, contingent_code, teacher_name, teacher_mobile, teacher_email)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        schoolData.name,
        schoolData.contingentCode ?? null,
        schoolData.teacherName,
        schoolData.teacherMobile,
        schoolData.teacherEmail
      );
    return findSchoolById(info.lastInsertRowid);
  }
}

function getEventById(eventId) {
  return db()
    .prepare('SELECT * FROM events WHERE id = ?')
    .get(eventId);
}

function deleteAllStageRegistrationsForSchool(schoolId) {
  db()
    .prepare('DELETE FROM event_registrations WHERE school_id = ?')
    .run(schoolId);
}

function selectStageRegistrationsForSchool(schoolId) {
  const regs = db()
    .prepare(
      `SELECT er.id as reg_id, er.school_id, er.event_id,
              e.name as event_name, e.description, e.min_participants, e.max_participants,
              e.min_grade, e.max_grade, e.gender_requirement
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.school_id = ?
       ORDER BY e.name ASC`
    )
    .all(schoolId);

  const partStmt = db().prepare(
    `SELECT name, grade, gender, participant_order
     FROM event_registration_participants
     WHERE event_registration_id = ?
     ORDER BY participant_order ASC`
  );

  return regs.map((r) => ({
    _id: r.reg_id, // mimic old shape when returning
    schoolId: r.school_id,
    eventId: r.event_id,
    participants: partStmt.all(r.reg_id),
    event: {
      name: r.event_name,
      description: r.description,
      minParticipants: r.min_participants,
      maxParticipants: r.max_participants,
      minGrade: r.min_grade,
      maxGrade: r.max_grade,
      genderRequirement: r.gender_requirement,
    },
  }));
}

function stageRegistrationsAdmin() {
  const rows = db()
    .prepare(
      `SELECT er.id as reg_id,
              s.id as school_id, s.name as school_name, s.contingent_code, s.teacher_name, s.teacher_email, s.teacher_mobile,
              e.id as event_id, e.name as event_name
       FROM event_registrations er
       JOIN schools s ON s.id = er.school_id
       JOIN events  e ON e.id = er.event_id
       ORDER BY s.name ASC, e.name ASC`
    )
    .all();

  const partStmt = db().prepare(
    `SELECT name, grade, gender, participant_order
     FROM event_registration_participants
     WHERE event_registration_id = ?
     ORDER BY participant_order ASC`
  );

  const grouped = {};
  for (const r of rows) {
    const sid = String(r.school_id);
    if (!grouped[sid]) {
      grouped[sid] = {
        school: {
          name: r.school_name,
          contingentCode: r.contingent_code,
          teacherName: r.teacher_name,
          teacherEmail: r.teacher_email,
          teacherMobile: r.teacher_mobile,
        },
        events: [],
      };
    }
    grouped[sid].events.push({
      eventName: r.event_name || '(Unknown event)',
      participants: partStmt.all(r.reg_id),
    });
  }
  return Object.values(grouped);
}

function sportsRegistrationsAdmin() {
  const rows = db()
    .prepare(
      `SELECT sr.id as reg_id,
              s.id as school_id, s.name as school_name, s.contingent_code, s.teacher_name, s.teacher_email, s.teacher_mobile,
              sr.event_id, sr.event_name
       FROM sports_registrations sr
       JOIN schools s ON s.id = sr.school_id
       ORDER BY s.name ASC, sr.event_name ASC`
    )
    .all();

  const partStmt = db().prepare(
    `SELECT name, grade, gender, weight, participant_order
     FROM sports_registration_participants
     WHERE sports_registration_id = ?
     ORDER BY participant_order ASC`
  );

  const grouped = {};
  for (const r of rows) {
    const sid = String(r.school_id);
    if (!grouped[sid]) {
      grouped[sid] = {
        school: {
          name: r.school_name,
          contingentCode: r.contingent_code,
          teacherName: r.teacher_name,
          teacherEmail: r.teacher_email,
          teacherMobile: r.teacher_mobile,
        },
        events: [],
      };
    }
    grouped[sid].events.push({
      eventName: r.event_name,
      participants: partStmt.all(r.reg_id),
    });
  }
  return Object.values(grouped);
}

function classroomRegistrationsAdmin() {
  const rows = db()
    .prepare(
      `SELECT cr.id as reg_id,
              s.id as school_id, s.name as school_name, s.contingent_code, s.teacher_name, s.teacher_email, s.teacher_mobile,
              cr.event_id, cr.event_name
       FROM classroom_registrations cr
       JOIN schools s ON s.id = cr.school_id
       ORDER BY s.name ASC, cr.event_name ASC`
    )
    .all();

  const partStmt = db().prepare(
    `SELECT name, grade, participant_order
     FROM classroom_registration_participants
     WHERE classroom_registration_id = ?
     ORDER BY participant_order ASC`
  );

  const grouped = {};
  for (const r of rows) {
    const sid = String(r.school_id);
    if (!grouped[sid]) {
      grouped[sid] = {
        school: {
          name: r.school_name,
          contingentCode: r.contingent_code,
          teacherName: r.teacher_name,
          teacherEmail: r.teacher_email,
          teacherMobile: r.teacher_mobile,
        },
        events: [],
      };
    }
    grouped[sid].events.push({
      eventName: r.event_name,
      participants: partStmt.all(r.reg_id),
    });
  }
  return Object.values(grouped);
}

function countTable(table) {
  const row = db().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return row.c || 0;
}

function getSportsEventName(eventId) {
  const sportsEventNames = {
    explorare: 'Explorare',
    monopolium: 'Monopolium',
    'football-u18-boys': 'Football: Category 1: U18 Boys',
    'football-u16-boys': 'Football: Category 2: U16 Boys',
    'football-u18-girls': 'Football: Category 3: U18 Girls',
    'basketball-u19-boys': 'Basketball: Boys (U19)',
    'basketball-u16-boys': 'Basketball: Boys (U16)',
    'basketball-u19-girls': 'Basketball: Girls (U19)',
    'basketball-u16-girls': 'Basketball: Girls (U16)',
    'gully-cricket': 'Gully Cricket',
    'table-tennis': 'Table Tennis',
    'tug-of-war-boys-u16': 'Tug Of War: Boys (Under 16)',
    'tug-of-war-boys-u19': 'Tug Of War: Boys (Under 19)',
    'tug-of-war-girls-u16': 'Tug Of War: Girls (Under 16)',
    'tug-of-war-girls-u19': 'Tug Of War: Girls (Under 19)',
  };
  return sportsEventNames[eventId] || eventId;
}

// -----------------------------------------------

// Admin authentication middleware
const requireAdminAuth = (req, res, next) => {
  if (!req.session.adminAuthenticated) {
    return res.status(401).json({ message: 'Admin authentication required' });
  }
  next();
};

// Admin login endpoint
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (username === adminUsername && password === adminPassword) {
      req.session.adminAuthenticated = true;
      req.session.adminUsername = username;
      res.json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Admin check authentication endpoint
router.get('/admin/check-auth', (req, res) => {
  res.json({ authenticated: !!req.session.adminAuthenticated });
});

// Admin logout endpoint
router.get('/admin/logout', (req, res) => {
  req.session.adminAuthenticated = false;
  req.session.adminUsername = null;
  res.redirect('/admin/login');
});

// Admin API endpoints for fetching registration data
router.get('/admin/api/registrations/stage', requireAdminAuth, async (req, res) => {
  try {
    res.json(stageRegistrationsAdmin());
  } catch (error) {
    console.error('Error fetching stage registrations for admin:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/admin/api/registrations/sports', requireAdminAuth, async (req, res) => {
  try {
    res.json(sportsRegistrationsAdmin());
  } catch (error) {
    console.error('Error fetching sports registrations for admin:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/admin/api/registrations/classroom', requireAdminAuth, async (req, res) => {
  try {
    res.json(classroomRegistrationsAdmin());
  } catch (error) {
    console.error('Error fetching classroom registrations for admin:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin summary endpoint
router.get('/admin/api/summary', requireAdminAuth, async (req, res) => {
  try {
    // Build event summary and school summary from three sources
    const stage = stageRegistrationsAdmin();
    const sports = sportsRegistrationsAdmin();
    const classroom = classroomRegistrationsAdmin();

    const eventSummary = {}; // name -> {participantCount, schools:Set}
    const add = (eventName, participants, schoolName) => {
      if (!eventSummary[eventName]) {
        eventSummary[eventName] = { participantCount: 0, schools: new Set() };
      }
      eventSummary[eventName].participantCount += Array.isArray(participants) ? participants.length : 0;
      eventSummary[eventName].schools.add(schoolName);
    };

    for (const s of stage) {
      for (const ev of s.events) add(ev.eventName || '(Unknown stage event)', ev.participants, s.school.name);
    }
    for (const s of sports) {
      for (const ev of s.events) add(ev.eventName, ev.participants, s.school.name);
    }
    for (const s of classroom) {
      for (const ev of s.events) add(ev.eventName, ev.participants, s.school.name);
    }

    const eventSummaryArray = Object.keys(eventSummary)
      .map((eventName) => ({
        eventName,
        participantCount: eventSummary[eventName].participantCount,
        schoolCount: eventSummary[eventName].schools.size,
      }))
      .sort((a, b) => b.participantCount - a.participantCount);

    const schoolSummary = {}; // name -> {totalEvents, totalParticipants}
    const foldSchool = (arr) => {
      for (const s of arr) {
        if (!schoolSummary[s.school.name]) schoolSummary[s.school.name] = { totalEvents: 0, totalParticipants: 0 };
        for (const ev of s.events) {
          schoolSummary[s.school.name].totalEvents += 1;
          schoolSummary[s.school.name].totalParticipants += Array.isArray(ev.participants) ? ev.participants.length : 0;
        }
      }
    };
    foldSchool(stage);
    foldSchool(sports);
    foldSchool(classroom);

    const schoolSummaryArray = Object.keys(schoolSummary)
      .map((name) => ({
        schoolName: name,
        totalEvents: schoolSummary[name].totalEvents,
        totalParticipants: schoolSummary[name].totalParticipants,
      }))
      .sort((a, b) => b.totalParticipants - a.totalParticipants);

    res.json({ eventSummary: eventSummaryArray, schoolSummary: schoolSummaryArray });
  } catch (error) {
    console.error('Error generating admin summary:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Debug: Check if models are available
console.log('Models loaded in registration routes (SQLite):', {
  hasDb: typeof db === 'function',
});

// Dummy auth middleware
const requireAuth = (req, res, next) => {
  next();
};

// Helper function to get school name for a username
function getSchoolNameForUser(username) {
  return userSchoolMapping[username] || null;
}

// Helper function to reload school configuration (useful for admin operations)
function reloadSchoolConfig() {
  loadSchoolConfig();
  return { success: true, message: 'School configuration reloaded', mappingCount: Object.keys(userSchoolMapping).length };
}

// Admin endpoint to reload school configuration
router.post('/admin/reload-config', requireAdminAuth, (req, res) => {
  try {
    const result = reloadSchoolConfig();
    res.json(result);
  } catch (error) {
    console.error('Error reloading school configuration:', error);
    res.status(500).json({ success: false, message: 'Failed to reload configuration' });
  }
});

// Admin endpoint to view current school mappings
router.get('/admin/school-mappings', requireAdminAuth, (req, res) => {
  try {
    res.json({
      mappings: userSchoolMapping,
      totalSchools: Object.keys(userSchoolMapping).length,
      configLoaded: !!schoolConfig,
    });
  } catch (error) {
    console.error('Error retrieving school mappings:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve mappings' });
  }
});

// Get stage events
router.get('/events/stage', async (req, res) => {
  try {
    const rows = db()
      .prepare('SELECT * FROM events WHERE is_active = 1 ORDER BY name ASC')
      .all();

    // Map to the old field names where useful
    const events = rows.map((r) => ({
      _id: String(r.id),
      name: r.name,
      categoryId: String(r.category_id),
      description: r.description,
      minParticipants: r.min_participants,
      maxParticipants: r.max_participants,
      minGrade: r.min_grade,
      maxGrade: r.max_grade,
      genderRequirement: r.gender_requirement,
      isActive: !!r.is_active,
    }));

    res.json(events);
  } catch (error) {
    console.error('Error fetching stage events:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Register for stage events
router.post('/register/stage', requireAuth, async (req, res) => {
  return res.status(503).json({ message: 'Stage registrations are currently closed.' });
  try {
    const { school: schoolData, events } = req.body;

    // Validate input
    if (!schoolData || !events || events.length === 0) {
      return res.status(400).json({ message: 'School data and events are required' });
    }

    // Create or update school
    const school = upsertSchool(schoolData);

    // Delete ALL existing registrations for this school first (cascade removes participants)
    deleteAllStageRegistrationsForSchool(school.id);
    console.log(`Deleted existing stage registrations for school: ${school.name}`);

    // Save all registrations and collect event names for sheets sync
    const eventsWithNames = [];

    for (const eventData of events) {
      const event = getEventById(eventData.eventId);
      if (!event) {
        return res.status(400).json({ message: `Event not found: ${eventData.eventId}` });
      }

      // Create new registration via helper that validates constraints & inserts participants
      dbModels.createEventRegistration({
        schoolId: school.id,
        eventId: eventData.eventId,
        registrationStatus: 'registered',
        participants: (eventData.participants || []).map((p) => ({
          name: p.name,
          grade: p.grade,
          gender: p.gender && p.gender.trim() !== '' ? p.gender : null,
          participantOrder: p.participantOrder,
        })),
      });

      console.log(`Registration saved for event: ${event.name}`);

      // Add event name for sheets sync
      eventsWithNames.push({
        ...eventData,
        eventName: event.name,
      });
    }

    console.log('All registrations completed successfully');

    // Send immediate success response to user
    res.status(201).json({
      message: 'Registration completed successfully',
      schoolId: school.id,
      eventsRegistered: events.length,
    });

    // Sync to Google Sheets in background (non-blocking)
    setImmediate(async () => {
      try {
        await googleSheetsService.addStageRegistration(dbModels);
        console.log('✅ Background Google Sheets sync completed');
      } catch (sheetsError) {
        console.warn('⚠️ Background Google Sheets sync failed:', sheetsError.message);
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get registration status for a school
router.get('/registrations/:schoolId', async (req, res) => {
  try {
    const { schoolId } = req.params;

    const school = findSchoolById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }

    const registrations = selectStageRegistrationsForSchool(school.id).map((r) => ({
      _id: r._id,
      schoolId: r.schoolId,
      eventId: r.eventId,
      participants: r.participants,
      event: {
        name: r.event.name,
        description: r.event.description,
        minParticipants: r.event.minParticipants,
        maxParticipants: r.event.maxParticipants,
        minGrade: r.event.minGrade,
        maxGrade: r.event.maxGrade,
        genderRequirement: r.event.genderRequirement,
      },
    }));

    res.json({
      school: {
        _id: school.id,
        name: school.name,
        contingentCode: school.contingent_code,
        teacherName: school.teacher_name,
        teacherMobile: school.teacher_mobile,
        teacherEmail: school.teacher_email,
      },
      registrations,
    });
  } catch (error) {
    console.error('Error fetching registrations:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Check if user has existing stage registrations
router.get('/check-stage-registration', async (req, res) => {
  try {
    // Use global mapping
    const username = req.session?.username || req.query.username || 'user1';
    const schoolName = getSchoolNameForUser(username);

    if (!schoolName) {
      return res.json({ hasRegistration: false });
    }

    const school = findSchoolByName(schoolName);
    if (!school) {
      return res.json({ hasRegistration: false });
    }

    // Check if school has any stage event registrations
    const regs = db()
      .prepare(`SELECT COUNT(*) AS c FROM event_registrations WHERE school_id = ?`)
      .get(school.id).c;

    const existingRegistrations = selectStageRegistrationsForSchool(school.id);

    res.json({
      hasRegistration: regs > 0,
      school: {
        _id: school.id,
        name: school.name,
        contingentCode: school.contingent_code,
        teacherName: school.teacher_name,
        teacherMobile: school.teacher_mobile,
        teacherEmail: school.teacher_email,
      },
      registrations: existingRegistrations.map((r) => ({
        _id: r._id,
        eventId: r.eventId,
        participants: r.participants,
        eventIdPopulated: { name: r.event.name }, // minimal equivalent to populate('eventId', 'name')
      })),
    });
  } catch (error) {
    console.error('Error checking registration:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Check if user has existing sports registrations
router.get('/check-sports-registration', async (req, res) => {
  try {
    // Use global mapping
    const username = req.session?.username || req.query.username || 'user1';
    const schoolName = getSchoolNameForUser(username);

    if (!schoolName) {
      return res.json({ hasRegistration: false });
    }

    const school = findSchoolByName(schoolName);
    if (!school) {
      return res.json({ hasRegistration: false });
    }

    // Check sports registrations for this school
    const regs = db()
      .prepare(`SELECT id, event_id, event_name FROM sports_registrations WHERE school_id = ?`)
      .all(school.id);

    const partStmt = db().prepare(
      `SELECT name, grade, gender, weight, participant_order
       FROM sports_registration_participants
       WHERE sports_registration_id = ?
       ORDER BY participant_order ASC`
    );

    const existingRegistrations = regs.map((r) => ({
      _id: r.id,
      schoolId: school.id,
      eventId: r.event_id,
      eventName: r.event_name,
      participants: partStmt.all(r.id),
    }));

    res.json({
      hasRegistration: existingRegistrations.length > 0,
      school: {
        _id: school.id,
        name: school.name,
        contingentCode: school.contingent_code,
        teacherName: school.teacher_name,
        teacherMobile: school.teacher_mobile,
        teacherEmail: school.teacher_email,
      },
      registrations: existingRegistrations,
    });
  } catch (error) {
    console.error('Error checking sports registration:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Check if user has existing classroom registrations
router.get('/check-classroom-registration', async (req, res) => {
  try {
    // Use global mapping
    const username = req.session?.username || req.query.username || 'user1';
    const schoolName = getSchoolNameForUser(username);

    console.log(username);
    console.log(schoolName);

    if (!schoolName) {
      return res.json({ hasRegistration: false });
    }

    console.log('schools table exists?', !!db());

    const school = findSchoolByName(schoolName);
    if (!school) {
      return res.json({ hasRegistration: false });
    }

    const regs = db()
      .prepare(`SELECT id, event_id, event_name FROM classroom_registrations WHERE school_id = ?`)
      .all(school.id);

    const partStmt = db().prepare(
      `SELECT name, grade, participant_order
       FROM classroom_registration_participants
       WHERE classroom_registration_id = ?
       ORDER BY participant_order ASC`
    );

    const existingRegistrations = regs.map((r) => ({
      _id: r.id,
      schoolId: school.id,
      eventId: r.event_id,
      eventName: r.event_name,
      participants: partStmt.all(r.id),
    }));

    res.json({
      hasRegistration: existingRegistrations.length > 0,
      school: {
        _id: school.id,
        name: school.name,
        contingentCode: school.contingent_code,
        teacherName: school.teacher_name,
        teacherMobile: school.teacher_mobile,
        teacherEmail: school.teacher_email,
      },
      registrations: existingRegistrations,
    });
  } catch (error) {
    console.error('Error checking classroom registration:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Register for classroom events
router.post('/register/classroom', async (req, res) => {
  return res.status(503).json({ message: 'Classroom registrations are currently closed.' });
  try {
    const { school: schoolData, events } = req.body;

    console.log('📊 Processing classroom registration for:', schoolData.name);

    // Validate input
    if (!schoolData || !events || events.length === 0) {
      return res.status(400).json({ message: 'School information and events are required' });
    }

    // Create or update school
    const school = upsertSchool(schoolData);

    // Event name mapping (keep same mapping)
    const eventNameMapping = {
      'admeta-cat1': 'Admeta: Category 1',
      'admeta-cat2': 'Admeta: Category 2',
      artem: 'Artem',
      'carmen-cat1': 'Carmen: Category 1',
      'carmen-cat2': 'Carmen: Category 2',
      fabula: 'Fabula',
      fortuna: 'Fortuna',
      codeferno: 'Codeferno',
      gustatio: 'Gustatio',
      mahim16: 'Mahim 16',
      adventurium: '‘Ad’venturium',
    };

    // Delete existing registrations for this school (cascade removes participants)
    db().prepare('DELETE FROM classroom_registrations WHERE school_id = ?').run(school.id);
    console.log('🗑️ Removed existing classroom registrations');

    // Create new registrations and collect events with names for sheets sync
    const eventsWithNames = [];
    const insertReg = db().prepare(
      `INSERT INTO classroom_registrations (school_id, event_id, event_name)
       VALUES (?, ?, ?)`
    );
    const insertPart = db().prepare(
      `INSERT INTO classroom_registration_participants
       (classroom_registration_id, name, grade, participant_order)
       VALUES (?, ?, ?, ?)`
    );

    const tx = db().transaction(() => {
      for (const eventData of events) {
        const eventName = eventNameMapping[eventData.eventId] || eventData.eventId;
        const info = insertReg.run(school.id, eventData.eventId, eventName);
        const regId = info.lastInsertRowid;
        for (const p of eventData.participants || []) {
          insertPart.run(regId, p.name, p.grade, p.participantOrder);
        }
        eventsWithNames.push({ ...eventData, eventName });
        console.log(`✅ Classroom registration prepared for event: ${eventName}`);
      }
    });

    tx();
    console.log('All classroom registrations completed successfully');

    // Send immediate success response to user
    res.json({
      message: 'Classroom events registration successful',
      schoolId: school.id,
      registeredEvents: events.length,
    });

    // Sync to Google Sheets in background (non-blocking)
    setImmediate(async () => {
      try {
        await googleSheetsService.addClassroomRegistration(dbModels);
        console.log('✅ Background Google Sheets sync completed for classroom');
      } catch (sheetsError) {
        console.warn('⚠️ Background Google Sheets sync failed for classroom:', sheetsError.message);
      }
    });
  } catch (error) {
    console.error('❌ Classroom registration error:', error);
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

// Get registration statistics
router.get('/stats/registrations', async (req, res) => {
  try {
    const stageRegistrationCount = countTable('event_registrations');
    const sportsRegistrationCount = countTable('sports_registrations');
    const classroomRegistrationCount = countTable('classroom_registrations');
    const totalRegistrations = stageRegistrationCount + sportsRegistrationCount + classroomRegistrationCount;

    res.json({
      totalRegistrations,
      totalStageRegistrations: stageRegistrationCount,
      totalSportsRegistrations: sportsRegistrationCount,
      totalClassroomRegistrations: classroomRegistrationCount,
      totalSchools: countTable('schools'),
    });
  } catch (error) {
    console.error('Error fetching registration statistics:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Sports registration endpoint
router.post('/register/sports', requireAuth, async (req, res) => {
  return res.status(503).json({ message: 'Sports registrations are currently closed.' });
  try {
    const { school: schoolData, events } = req.body;

    console.log('📊 Processing sports registration for:', schoolData.name);

    // Find or create school
    const school = upsertSchool(schoolData);
    console.log('✅ School upserted for sports registration');

    // Remove existing sports registrations for this school (cascade removes participants)
    db().prepare('DELETE FROM sports_registrations WHERE school_id = ?').run(school.id);
    console.log('🗑️ Removed existing sports registrations');

    // Create new registrations
    const insertReg = db().prepare(
      `INSERT INTO sports_registrations (school_id, event_id, event_name)
       VALUES (?, ?, ?)`
    );
    const insertPart = db().prepare(
      `INSERT INTO sports_registration_participants
       (sports_registration_id, name, grade, gender, weight, participant_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const eventsWithNames = [];
    const tx = db().transaction(() => {
      for (const eventData of events) {
        const eventName = getSportsEventName(eventData.eventId);
        const info = insertReg.run(school.id, eventData.eventId, eventName);
        const regId = info.lastInsertRowid;

        for (const p of eventData.participants || []) {
          insertPart.run(regId, p.name, p.grade, p.gender ?? null, p.weight ?? null, p.participantOrder);
        }

        eventsWithNames.push({ ...eventData, eventName });
        console.log(`✅ Sports registration saved for event: ${eventName}`);
      }
    });

    tx();
    console.log('All sports registrations completed successfully');

    // Send immediate success response to user
    res.status(201).json({
      message: 'Sports registration completed successfully',
      schoolId: school.id,
      eventsRegistered: events.length,
    });

    // Sync to Google Sheets in background (non-blocking)
    setImmediate(async () => {
      try {
        await googleSheetsService.addSportsRegistration(dbModels);
        console.log('✅ Background Google Sheets sync completed for sports');
      } catch (sheetsError) {
        console.warn('⚠️ Background Google Sheets sync failed for sports:', sheetsError.message);
      }
    });
  } catch (error) {
    console.error('❌ Sports registration error:', error);
    res.status(500).json({
      message: 'Sports registration failed',
      error: error.message,
    });
  }
});

module.exports = router;