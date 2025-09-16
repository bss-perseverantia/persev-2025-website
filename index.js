const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const crypto = require('crypto');

// Import API routes
const registrationRoutes = require('./routes/registration');
// Import database initialization
const { initializeDatabase } = require('./database/init_db');

const app = express();
const PORT = 3000;
const thirtyDays = 1000 * 60 * 60 * 24 * 30; // 30 days in milliseconds

app.use(require("express").json())    // <==== parse request body as JSON
      const bodyParser = require('body-parser');
      app.use(bodyParser.urlencoded({ extended: false }));
      app.use(bodyParser.json())
      app.use(require("express-session")({
        secret: require('crypto').randomBytes(16).toString("hex"),
        cookie: { maxAge: thirtyDays },
        resave: true,
        saveUninitialized: true
      }))

// Load environment variables from .env file
dotenv.config();

// Load school configuration
let schoolConfig = {};
try {
    const schoolConfigPath = path.join(__dirname, 'school_config.json');
    if (fs.existsSync(schoolConfigPath)) {
        schoolConfig = JSON.parse(fs.readFileSync(schoolConfigPath, 'utf8'));
    }
} catch (error) {
    console.error('Error loading school config:', error.message);
    schoolConfig = { schools: [] };
}

// Extract usernames and passwords from school config
const unames = schoolConfig.schools ? schoolConfig.schools.map(school => school.username) : [];
const plainPasswords = schoolConfig.schools ? schoolConfig.schools.map(school => school.password) : [];

// Hash all passwords at runtime
const passwords = plainPasswords.map(password => hashPassword(password));

console.log('Loaded users:', unames);

// Create user to school mapping from school config
const userSchoolMapping = {};

// Add default test users
const defaultUsers = {
    'user1': { name: 'JB Vaccha High School', contingentCode: 'JBV001' },
    'user2': { name: 'Delhi Public School', contingentCode: 'DPS002' },
    'user3': { name: 'Ryan International School', contingentCode: 'RIS003' },
    'user4': { name: 'St. Xavier\'s High School', contingentCode: 'SXH004' },
    'user5': { name: 'Greenwood High School', contingentCode: 'GHS005' },
    'user6': { name: 'Blue Ridge International School', contingentCode: 'BRIS006' },
    'user7': { name: 'Silver Oak Academy', contingentCode: 'SOA007' },
    'user8': { name: 'Maple Leaf International School', contingentCode: 'MLIS008' },
    'user9': { name: 'Oakridge International School', contingentCode: 'OIS009' },
    'user10': { name: 'Heritage School', contingentCode: 'HS010' },
    'admin': { name: 'Admin', contingentCode: 'ADMIN' }
};

// Add default users to mapping
Object.assign(userSchoolMapping, defaultUsers);

// Add schools from config to mapping
if (schoolConfig.schools) {
    schoolConfig.schools.forEach(school => {
        userSchoolMapping[school.username] = {
            name: school.schoolName,
            contingentCode: school.schoolCode
        };
    });
}


// Serve static files from the "assets" folder
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use("/views",express.static(path.join(__dirname, 'views')));
app.use("/static",express.static(path.join(__dirname, 'static')));

// Use API routes
app.use('/api', registrationRoutes);
app.use('/', registrationRoutes); // For admin routes


function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function isLoggedIn(req,res,next){
        for(let i=0;i<unames.length;i++){
            if(unames[i]==req.session.username && passwords[i]==req.session.password){
                return next();
            }
        }
        res.redirect("/login?error=access");
}
app.get("/robots.txt",(req,res)=>{
    res.sendFile(process.cwd()+"/static/robots.txt")
})
app.get("/google76278944d3b229c9.html",(req,res)=>{
    res.sendFile(process.cwd()+"/static/google76278944d3b229c9.html")
})


app.post("/pass/validate/",async (req,res)=>{
        let uname= req.body.username;
        let pass = req.body.password;
        let hashedPass = hashPassword(pass);
        for(let i=0;i<unames.length;i++){
            if(unames[i]==uname && passwords[i]==hashedPass){
                return res.json({data:true})
            }
        }
        return res.json({data:false})
    })

    app.get('/login',  (req, res) => {
      // If this is a login attempt with credentials
      if (req.query.username && req.query.password) {
          // Validate credentials
          let validLogin = false;
          let hashedPass = hashPassword(req.query.password);
          for(let i = 0; i < unames.length; i++) {
              if(unames[i] === req.query.username && passwords[i] === hashedPass) {
                  validLogin = true;
                  break;
              }
          }
          
          if (validLogin) {
              req.session.username = req.query.username;
              req.session.password = hashedPass;
              res.redirect("/panel");
          } else {
              res.redirect("/login?error=invalid");
          }
      } else {
          // Just serving the login page
          res.sendFile(path.join(__dirname, 'views', 'login.html'));
      }
    })
    app.get('/logout',  (req, res) => {
      req.session.username = "";
      req.session.password = "";
      res.redirect("/")
    })
    app.get("/panel",isLoggedIn,(req,res)=>{
        const data = fs.readFileSync(__dirname+"/views/panel.html").toString()
        const auth = req.session.username+"-"+req.session.password
        res.send(data.replace(/(!auth)/g,auth));
    })
app.get('/events', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'events.html'));
});

app.get('/stage-registration', isLoggedIn,(req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'stage-registration.html'));
});

app.get('/sports-gaming-registration', isLoggedIn,(req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'sports-gaming-registration.html'));
});

app.get('/api/user/school-info', (req, res) => {
    // Get username from session or query parameter for testing
    const username = req.session.username || req.query.username;
    
    if (!username || !userSchoolMapping[username]) {
        return res.status(404).json({ message: 'School information not found for user' });
    }
    
    res.json(userSchoolMapping[username]);
});

app.get('/organizing-committee', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'organizing-committee.html'));
});

app.get('/handbook', (req, res) => {
    res.sendFile(path.join(__dirname, 'assets', 'handbook.pdf'));
});

app.get('/leaderboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'leaderboard_coming_soon.html'));
});

app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'style.css'));
});

app.get('/style2.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'style2.css'));
});

app.get('/config.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'config_sorted.json'));
});
// Route to serve the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.min.html'));
});

app.get('/school-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/api/participating-schools', (req, res) => {
    // Return the count of participating schools
    res.json({ count: unames.length });
});

// Classroom registration page
app.get('/classroom-registration', isLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, 'views/classroom-registration.html'));
});

// Admin routes
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/admin-login.html'));
});

app.get('/admin/dashboard', (req, res) => {
    // Check if admin is authenticated
    if (!req.session.adminAuthenticated) {
        return res.redirect('/admin/login');
    }
    res.sendFile(path.join(__dirname, 'views/website-admin-dashboard.html'));
});

// Catch-all route for undefined paths to serve 404.html
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'views', '404.html'));
});

// Initialize database and start server
async function startServer() {
    try {
        console.log('🔄 Initializing database connection...');
        await initializeDatabase();
        console.log('✅ Database connected successfully!');
        
        app.listen(PORT, () => {
            console.log(`🚀 Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();

