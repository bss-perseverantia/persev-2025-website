const { google } = require('googleapis');
const path = require('path');

class GoogleSheetsService {
    constructor() {
        this.sheets = null;
        this.spreadsheetId = '1yQ3ctzl7xL_UsxDQTDV1P00zKFSSk6NWCuDPp_Cr6Dg';
        this.classroomSheetName = process.env.CLASSROOM_SHEET_NAME || 'Classroom Events';
        this.init();
    }

    async init() {
        try {
            // Load service account credentials from environment or file
            let credentials;
            
            if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
                // Load from environment variable (for production)
                credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
            } else {
                // Load from file (for development)
                const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
                credentials = require(credentialsPath);
            }

            const auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: [
                    'https://www.googleapis.com/auth/spreadsheets',
                    'https://www.googleapis.com/auth/drive.file'
                ]
            });

            this.sheets = google.sheets({ version: 'v4', auth });
            console.log('✅ Google Sheets service initialized');
            
            // Initialize sheets
            await this.initializeSheets();
        } catch (error) {
            console.error('❌ Failed to initialize Google Sheets:', error.message);
            // Don't throw - allow app to continue without sheets integration
        }
    }

    async initializeSheets() {
        try {
            // Get current sheets
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId
            });

            const sheetNames = spreadsheet.data.sheets.map(sheet => sheet.properties.title);

            // Initialize Stage Registrations sheet
            if (!sheetNames.includes('Stage Registrations')) {
                await this.createSheet('Stage Registrations', [
                    'Timestamp',
                    'School Name',
                    'Contingent Code',
                    'Teacher Name',
                    'Teacher Mobile',
                    'Teacher Email',
                    'Event Name',
                    'Participant Name',
                    'Grade',
                    'Gender',
                    'Participant Order'
                ]);
            } else {
                await this.ensureHeaders('Stage Registrations', [
                    'Timestamp',
                    'School Name',
                    'Contingent Code',
                    'Teacher Name',
                    'Teacher Mobile',
                    'Teacher Email',
                    'Event Name',
                    'Participant Name',
                    'Grade',
                    'Gender',
                    'Participant Order'
                ]);
            }

            // Initialize Sports Registrations sheet
            if (!sheetNames.includes('Sports Registrations')) {
                await this.createSheet('Sports Registrations', [
                    'Timestamp',
                    'School Name',
                    'Contingent Code',
                    'Teacher Name',
                    'Teacher Mobile',
                    'Teacher Email',
                    'Event Name',
                    'Participant Name',
                    'Grade',
                    'Gender',
                    'Weight (kg)',
                    'Participant Order'
                ]);
            } else {
                await this.ensureHeaders('Sports Registrations', [
                    'Timestamp',
                    'School Name',
                    'Contingent Code',
                    'Teacher Name',
                    'Teacher Mobile',
                    'Teacher Email',
                    'Event Name',
                    'Participant Name',
                    'Grade',
                    'Gender',
                    'Weight (kg)',
                    'Participant Order'
                ]);
            }

            // Initialize Classroom Events sheet
            if (!sheetNames.includes(this.classroomSheetName)) {
                await this.createSheet(this.classroomSheetName, this.getClassroomHeaders());
            } else {
                await this.ensureHeaders(this.classroomSheetName, this.getClassroomHeaders());
            }

        } catch (error) {
            console.error('❌ Failed to initialize sheets:', error.message);
        }
    }

    async addStageRegistration(dbModels) {
        if (!this.sheets) {
            console.warn('Google Sheets not available, skipping sync');
            return;
        }

        try {
            console.log('📊 Rebuilding Stage Registrations sheet from database...');
            
            // Ensure the sheet exists
            await this.createSheetIfNotExists('Stage Registrations');
            
            // Get ALL stage registrations from database
            const allRegistrations = this.getAllStageRegistrationsFromDB(dbModels);
            
            // Clear the entire sheet and rebuild from scratch
            await this.rebuildStageSheet(allRegistrations);

            console.log(`✅ Stage Registrations sheet rebuilt with ${allRegistrations.length} total rows`);
            return { totalRows: allRegistrations.length };

        } catch (error) {
            console.error('❌ Failed to rebuild Stage Registrations sheet:', error.message);
            // Don't throw - registration should still succeed even if sheets fails
        }
    }

    getAllStageRegistrationsFromDB(dbModels) {
        const db = dbModels.db();
        const rows = db.prepare(`
            SELECT 
                s.name as school_name,
                s.contingent_code,
                s.teacher_name,
                s.teacher_email,
                s.teacher_mobile,
                e.name as event_name,
                p.name as participant_name,
                p.grade,
                p.gender,
                p.participant_order,
                er.created_at
            FROM event_registrations er
            JOIN schools s ON s.id = er.school_id
            JOIN events e ON e.id = er.event_id
            JOIN event_registration_participants p ON p.event_registration_id = er.id
            ORDER BY s.name, e.name, p.participant_order
        `).all();

        return rows.map(row => [
            row.created_at || new Date().toISOString(),
            row.school_name,
            row.contingent_code || '',
            row.teacher_name,
            row.teacher_mobile,
            row.teacher_email,
            row.event_name,
            row.participant_name,
            row.grade,
            row.gender || '',
            row.participant_order || ''
        ]);
    }

    async rebuildStageSheet(allData) {
        try {
            // Clear the entire sheet
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: 'Stage Registrations!A:K'
            });

            // Add headers first
            const headers = [
                'Timestamp', 'School Name', 'Contingent Code', 'Teacher Name',
                'Teacher Mobile', 'Teacher Email', 'Event Name', 'Participant Name',
                'Grade', 'Gender', 'Participant Order'
            ];

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: 'Stage Registrations!A1:K1',
                valueInputOption: 'RAW',
                resource: {
                    values: [headers]
                }
            });

            // Add all data if any exists
            if (allData.length > 0) {
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Stage Registrations!A:K',
                    valueInputOption: 'RAW',
                    resource: {
                        values: allData
                    }
                });
            }

            console.log(`✅ Stage sheet completely rebuilt with ${allData.length} rows`);
        } catch (error) {
            console.error('❌ Failed to rebuild stage sheet:', error.message);
            throw error;
        }
    }

    async getAllSheetData() {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Stage Registrations!A:K'
            });

            const rows = response.data.values || [];
            
            // Return data without headers (skip first row if it exists)
            if (rows.length > 0 && rows[0][0] === 'Timestamp') {
                return rows.slice(1); // Skip header row
            }
            
            return rows;
        } catch (error) {
            console.warn('⚠️ Could not get existing sheet data:', error.message);
            return []; // Return empty array if sheet doesn't exist yet
        }
    }

    removeSchoolEntries(data, schoolName) {
        // Filter out all rows that belong to this school (column B contains school name)
        return data.filter(row => {
            if (!row || row.length < 2) return true; // Keep malformed rows
            return row[1] !== schoolName; // Keep rows where school name doesn't match
        });
    }

    async updateEntireSheet(data) {
        try {
            // Clear the sheet first (except headers)
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: 'Stage Registrations!A2:K'
            });

            // Ensure headers exist
            await this.ensureHeaders();

            // If there's data to write, append it
            if (data.length > 0) {
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Stage Registrations!A:K',
                    valueInputOption: 'RAW',
                    resource: {
                        values: data
                    }
                });
            }

            console.log(`✅ Sheet updated with ${data.length} total rows`);
        } catch (error) {
            console.error('❌ Failed to update entire sheet:', error.message);
            throw error;
        }
    }

    async ensureHeaders(sheetName = 'Stage Registrations', headers) {
        try {
            // Check if headers already exist
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A1:K1`
            });

            if (!response.data.values || response.data.values.length === 0) {
                // Add headers
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: `${sheetName}!A1:K1`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [headers]
                    }
                });

                console.log(`✅ Added headers to ${sheetName} sheet`);
            }
        } catch (error) {
            // If the sheet doesn't exist, createSheetIfNotExists will handle it
            console.warn(`⚠️ Headers check failed for ${sheetName} (sheet may not exist yet):`, error.message);
        }
    }

    async createSheet(sheetName, headers) {
        try {
            // Create the sheet
            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: sheetName
                            }
                        }
                    }]
                }
            });
            console.log(`✅ Created sheet: ${sheetName}`);
            
            // Add headers to the new sheet immediately
            const range = `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`;
            
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: range,
                valueInputOption: 'RAW',
                resource: {
                    values: [headers]
                }
            });

            console.log(`✅ Added headers to new sheet: ${sheetName}`);
        } catch (error) {
            console.error(`❌ Failed to create sheet ${sheetName}:`, error.message);
        }
    }

    async createSheetIfNotExists(sheetName) {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId
            });

            const sheetNames = spreadsheet.data.sheets.map(sheet => sheet.properties.title);
            
            if (!sheetNames.includes(sheetName)) {
                let headers = [];
                if (sheetName === 'Stage Registrations') {
                    headers = [
                        'Timestamp', 'School Name', 'Contingent Code', 'Teacher Name',
                        'Teacher Mobile', 'Teacher Email', 'Event Name', 'Participant Name',
                        'Grade', 'Gender', 'Participant Order'
                    ];
                } else if (sheetName === 'Sports Registrations') {
                    headers = [
                        'Timestamp', 'School Name', 'Contingent Code', 'Teacher Name',
                        'Teacher Mobile', 'Teacher Email', 'Event Name', 'Participant Name',
                        'Grade', 'Gender', 'Weight (kg)', 'Participant Order'
                    ];
                } else if (sheetName === this.classroomSheetName) {
                    headers = this.getClassroomHeaders();
                }
                
                await this.createSheet(sheetName, headers);
            }
        } catch (error) {
            console.error(`❌ Failed to check/create sheet ${sheetName}:`, error.message);
        }
    }

    async addSportsRegistration(dbModels) {
        if (!this.sheets) {
            console.warn('Google Sheets not available, skipping sync');
            return;
        }

        try {
            console.log('📊 Rebuilding Sports Registrations sheet from database...');
            
            // Ensure the sheet exists
            await this.createSheetIfNotExists('Sports Registrations');
            
            // Get ALL sports registrations from database
            const allRegistrations = this.getAllSportsRegistrationsFromDB(dbModels);
            
            // Clear the entire sheet and rebuild from scratch
            await this.rebuildSportsSheet(allRegistrations);

            console.log(`✅ Sports Registrations sheet rebuilt with ${allRegistrations.length} total rows`);
            return { totalRows: allRegistrations.length };

        } catch (error) {
            console.error('❌ Failed to rebuild Sports Registrations sheet:', error.message);
            // Don't throw - registration should still succeed even if sheets fails
        }
    }

    getAllSportsRegistrationsFromDB(dbModels) {
        const db = dbModels.db();
        const rows = db.prepare(`
            SELECT 
                s.name as school_name,
                s.contingent_code,
                s.teacher_name,
                s.teacher_email,
                s.teacher_mobile,
                sr.event_name,
                p.name as participant_name,
                p.grade,
                p.gender,
                p.weight,
                p.participant_order,
                sr.registration_date
            FROM sports_registrations sr
            JOIN schools s ON s.id = sr.school_id
            JOIN sports_registration_participants p ON p.sports_registration_id = sr.id
            ORDER BY s.name, sr.event_name, p.participant_order
        `).all();

        return rows.map(row => [
            row.registration_date || new Date().toISOString(),
            row.school_name,
            row.contingent_code || '',
            row.teacher_name,
            row.teacher_mobile,
            row.teacher_email,
            row.event_name,
            row.participant_name,
            row.grade,
            row.gender || '',
            row.weight || '',
            row.participant_order || ''
        ]);
    }

    async rebuildSportsSheet(allData) {
        try {
            // Clear the entire sheet
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: 'Sports Registrations!A:L'
            });

            // Add headers first
            const headers = [
                'Timestamp', 'School Name', 'Contingent Code', 'Teacher Name',
                'Teacher Mobile', 'Teacher Email', 'Event Name', 'Participant Name',
                'Grade', 'Gender', 'Weight (kg)', 'Participant Order'
            ];

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: 'Sports Registrations!A1:L1',
                valueInputOption: 'RAW',
                resource: {
                    values: [headers]
                }
            });

            // Add all data if any exists
            if (allData.length > 0) {
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Sports Registrations!A:L',
                    valueInputOption: 'RAW',
                    resource: {
                        values: allData
                    }
                });
            }

            console.log(`✅ Sports sheet completely rebuilt with ${allData.length} rows`);
        } catch (error) {
            console.error('❌ Failed to rebuild sports sheet:', error.message);
            throw error;
        }
    }

    async getAllSportsSheetData() {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Sports Registrations!A:L'
            });

            const rows = response.data.values || [];
            
            // Return data without headers (skip first row if it exists)
            if (rows.length > 0 && rows[0][0] === 'Timestamp') {
                return rows.slice(1); // Skip header row
            }
            
            return rows;
        } catch (error) {
            console.warn('⚠️ Could not get existing sports sheet data:', error.message);
            return []; // Return empty array if sheet doesn't exist yet
        }
    }

    async updateEntireSportsSheet(data) {
        try {
            // Clear the sheet first (except headers)
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: 'Sports Registrations!A2:L'
            });

            // Ensure headers exist
            await this.ensureSportsHeaders();

            // If there's data to write, append it
            if (data.length > 0) {
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Sports Registrations!A:L',
                    valueInputOption: 'RAW',
                    resource: {
                        values: data
                    }
                });
            }

            console.log(`✅ Sports sheet updated with ${data.length} total rows`);
        } catch (error) {
            console.error('❌ Failed to update entire sports sheet:', error.message);
            throw error;
        }
    }

    async ensureSportsHeaders() {
        try {
            // Check if headers already exist
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Sports Registrations!A1:L1'
            });

            if (!response.data.values || response.data.values.length === 0) {
                // Add headers
                const headers = [
                    'Timestamp',
                    'School Name',
                    'Contingent Code',
                    'Teacher Name',
                    'Teacher Mobile',
                    'Teacher Email',
                    'Event Name',
                    'Participant Name',
                    'Grade',
                    'Gender',
                    'Weight (kg)',
                    'Participant Order'
                ];

                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: 'Sports Registrations!A1:L1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [headers]
                    }
                });

                console.log('✅ Added headers to Sports Google Sheets');
            }
        } catch (error) {
            // If the sheet doesn't exist, createSheetIfNotExists will handle it
            console.warn('⚠️ Sports headers check failed (sheet may not exist yet):', error.message);
        }
    }

    async getRegistrationStats() {
        if (!this.sheets) return null;

        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Stage Registrations!A:K'
            });

            const rows = response.data.values || [];
            return {
                totalEntries: Math.max(0, rows.length - 1), // Exclude header
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Failed to get stats from Google Sheets:', error.message);
            return null;
        }
    }

    async addClassroomRegistration(dbModels) {
        if (!this.sheets) {
            console.warn('Google Sheets not available, skipping sync');
            return;
        }

        try {
            console.log('📊 Rebuilding Classroom Events sheet from database...');
            
            // Ensure the sheet exists
            await this.createSheetIfNotExists(this.classroomSheetName);
            
            // Get ALL classroom registrations from database
            const allRegistrations = this.getAllClassroomRegistrationsFromDB(dbModels);
            
            // Clear the entire sheet and rebuild from scratch
            await this.rebuildClassroomSheet(allRegistrations);

            console.log(`✅ Classroom Events sheet rebuilt with ${allRegistrations.length} total rows`);
            return { totalRows: allRegistrations.length };

        } catch (error) {
            console.error('❌ Failed to rebuild Classroom Events sheet:', error.message);
            // Don't throw - registration should still succeed even if sheets fails
        }
    }

    getAllClassroomRegistrationsFromDB(dbModels) {
        const db = dbModels.db();
        const rows = db.prepare(`
            SELECT 
                s.name as school_name,
                s.contingent_code,
                s.teacher_name,
                s.teacher_email,
                s.teacher_mobile,
                cr.event_name,
                p.name as participant_name,
                p.grade,
                cr.registration_date
            FROM classroom_registrations cr
            JOIN schools s ON s.id = cr.school_id
            JOIN classroom_registration_participants p ON p.classroom_registration_id = cr.id
            ORDER BY s.name, cr.event_name, p.participant_order
        `).all();

        return rows.map(row => [
            row.registration_date || new Date().toISOString(),
            row.school_name,
            row.contingent_code || '',
            row.teacher_name,
            row.teacher_mobile,
            row.teacher_email,
            row.event_name,
            row.participant_name,
            row.grade
        ]);
    }

    async rebuildClassroomSheet(allData) {
        try {
            // Clear the entire sheet
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${this.classroomSheetName}!A:I`
            });

            // Add headers first
            const headers = this.getClassroomHeaders();

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${this.classroomSheetName}!A1:I1`,
                valueInputOption: 'RAW',
                resource: {
                    values: [headers]
                }
            });

            // Add all data if any exists
            if (allData.length > 0) {
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.spreadsheetId,
                    range: `${this.classroomSheetName}!A:I`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: allData
                    }
                });
            }

            console.log(`✅ Classroom sheet completely rebuilt with ${allData.length} rows`);
        } catch (error) {
            console.error('❌ Failed to rebuild classroom sheet:', error.message);
            throw error;
        }
    }

    async getAllClassroomSheetData() {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.classroomSheetName}!A:I`
            });

            const rows = response.data.values || [];
            
            // Return data without headers (skip first row if it exists)
            if (rows.length > 0 && rows[0][0] === 'Timestamp') {
                return rows.slice(1); // Skip header row
            }
            
            return rows;
        } catch (error) {
            console.warn('⚠️ Could not get existing classroom sheet data:', error.message);
            return []; // Return empty array if sheet doesn't exist yet
        }
    }

    async updateEntireClassroomSheet(data) {
        try {
            // Clear the sheet first (except headers)
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${this.classroomSheetName}!A2:I`
            });

            // Ensure headers exist
            await this.ensureClassroomHeaders();

            // If there's data to write, append it
            if (data.length > 0) {
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.spreadsheetId,
                    range: `${this.classroomSheetName}!A:I`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: data
                    }
                });
            }

            console.log(`✅ Classroom sheet updated with ${data.length} total rows`);
        } catch (error) {
            console.error('❌ Failed to update entire classroom sheet:', error.message);
            throw error;
        }
    }

    async ensureClassroomHeaders() {
        try {
            // Check if headers already exist
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.classroomSheetName}!A1:I1`
            });

            if (!response.data.values || response.data.values.length === 0) {
                // Add headers
                const headers = this.getClassroomHeaders();

                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: `${this.classroomSheetName}!A1:I1`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [headers]
                    }
                });

                console.log(`✅ Added headers to ${this.classroomSheetName} sheet`);
            }
        } catch (error) {
            // If the sheet doesn't exist, createSheetIfNotExists will handle it
            console.warn(`⚠️ Classroom headers check failed (sheet may not exist yet):`, error.message);
        }
    }

    getClassroomHeaders() {
        return [
            'Timestamp',
            'School Name',
            'Contingent Code',
            'Teacher Name',
            'Teacher Mobile',
            'Teacher Email',
            'Event Name',
            'Participant Name',
            'Grade'
        ];
    }
}

module.exports = new GoogleSheetsService();