// server.js

const express = require('express');
const http = require('http');
const session = require('express-session');
const ejs = require('ejs');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = 3000;

// Set the view engine to EJS
app.set('view engine', 'ejs');

// Set the directory for views
app.set('views', path.join(__dirname, 'views'));

// PostgreSQL database configuration
const pool = new Pool({
  user: '', 
  host: 'localhost',
  database: 'postgres', 
  password: '', 
  port: 5000, 
});

// Middleware to parse JSON bodies
app.use(express.json());
// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));
// Middleware to use session
app.use(session({
  secret: '9820467284636515374856382957329583',
  resave: false,
  saveUninitialized: true
}));

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Middleware to check if user is authenticated
const authenticateUser = (req, res, next) => {
  if (req.session.loggedIn) {
    console.log('User is logged in.');
    next();
  } else {
    console.log('User is not logged in.');
    res.redirect('/login.html');
  }
};

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toDateString();
}


// Middleware to render admin.html with loggedIn variable
app.get('/admin', authenticateUser, (req, res) => {
  // Check if user is logged in
  const loggedIn = req.session.loggedIn || false;

  // Render admin.html with loggedIn variable
  res.render('admin', { loggedIn }); // Assuming your EJS file is named admin.ejs
});

// Handle admin login
app.post('/admin-login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    client.release();
    if (result.rows.length === 1) {
      req.session.loggedIn = true; // Set loggedIn to true in the session
      res.status(200).send('Login successful');
    } else {
      res.status(401).send('Invalid username or password.');
    }
  } catch (error) {
    console.error('Error executing login query', error);
    res.status(500).send('An error occurred while processing your request.');
  }
});

// Route to render dashboard page
app.get('/dashboard', authenticateUser, (req, res) => {
  res.render('dashboard'); // Assuming your EJS file is named dashboard.ejs
});

// Route to handle new membership application form submission
app.post('/submit-application', async (req, res) => {
  const { fullName, email, phone, emergencyContact, membershipFee } = req.body;
  try {
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO membership_applications (full_name, email, phone, emergency_contact, membership_fee) VALUES ($1, $2, $3, $4, $5)',
      [fullName, email, phone, emergencyContact, membershipFee]
    );
    client.release();
    res.status(200).send('Application submitted successfully. We will review your application and get back to you soon.');
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).send('An error occurred while processing your request.');
  }
});

// Route to fetch membership applications
app.get('/get-applications', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM membership_applications');
    client.release();
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).send('An error occurred while fetching applications.');
  }
});

// Route to approve a membership application and move it to active_members table
app.post('/approve-application/:id', async (req, res) => {
  const applicationId = req.params.id;
  try {
    const client = await pool.connect();
    
    // Get the application details
    const applicationResult = await client.query('SELECT * FROM membership_applications WHERE id = $1', [applicationId]);
    if (applicationResult.rows.length === 0) {
      // Application not found
      client.release();
      return res.status(404).send('Application not found.');
    }
    const application = applicationResult.rows[0];
    
    // Insert the application into active_members table without specifying the id column
    await client.query('INSERT INTO active_members (full_name, email, phone, date_joined, payment_status) VALUES ($1, $2, $3, $4, $5)', 
                      [application.full_name, application.email, application.phone, new Date(), 'pending']);
    
    // Update the approved status of the application
    await client.query('UPDATE membership_applications SET approved = true WHERE id = $1', [applicationId]);
    
    // Remove the approved application from membership_applications table
    await client.query('DELETE FROM membership_applications WHERE id = $1', [applicationId]);

    client.release();
    res.sendStatus(200);
  } catch (error) {
    console.error('Error approving application:', error);
    res.status(500).send('An error occurred while approving the application.');
  }
});





// Route to deny a membership application with confirmation
app.post('/deny-application/:id', async (req, res) => {
  const applicationId = req.params.id;
  try {
    const client = await pool.connect();
    // First, fetch the application details for confirmation
    const result = await client.query('SELECT * FROM membership_applications WHERE id = $1', [applicationId]);
    if (result.rows.length === 0) {
      // Application not found
      client.release();
      return res.status(404).send('Application not found.');
    }
    const application = result.rows[0];
    client.release();
    
    // Send confirmation message with application details
    res.status(200).json({ confirmation: 'Are you sure you want to deny this application?', application });
  } catch (error) {
    console.error('Error denying application:', error);
    res.status(500).send('An error occurred while processing your request.');
  }
});

// Route to actually deny the membership application
app.post('/confirm-deny-application/:id', async (req, res) => {
  const applicationId = req.params.id;
  try {
    const client = await pool.connect();
    await client.query('DELETE FROM membership_applications WHERE id = $1', [applicationId]);
    client.release();
    res.sendStatus(200);
  } catch (error) {
    console.error('Error denying application:', error);
    res.status(500).send('An error occurred while denying the application.');
  }
});


// Server-side code (server.js)
app.get('/statistics', async (req, res) => {
  try {
    const client = await pool.connect();
    
    // Fetch total active members and their counts with dates
    const totalActiveMembersResult = await client.query('SELECT date_joined, COUNT(id) AS total_active_members FROM active_members GROUP BY date_joined ORDER BY date_joined');
    
    // Fetch applications needing review and their counts with dates
    const applicationsNeedingReviewResult = await client.query('SELECT date_submitted, COUNT(id) AS applications_needing_review FROM membership_applications WHERE approved = false GROUP BY date_submitted ORDER BY date_submitted');
    
    client.release();
    
    console.log('Total Active Members Data:', totalActiveMembersResult.rows);
    console.log('Applications Needing Review Data:', applicationsNeedingReviewResult.rows);
    
    // Extract data for total active members
    const totalActiveMembersData = totalActiveMembersResult.rows.map(row => ({
      date: row.date_joined,
      value: row.total_active_members
    }));
    
    // Extract data for applications needing review
    const applicationsNeedingReviewData = applicationsNeedingReviewResult.rows.map(row => ({
      date: row.date_submitted,
      value: row.applications_needing_review
    }));
    
    console.log('Formatted Total Active Members Data:', totalActiveMembersData);
    console.log('Formatted Applications Needing Review Data:', applicationsNeedingReviewData);
    
    res.json({ totalActiveMembers: totalActiveMembersData, applicationsNeedingReview: applicationsNeedingReviewData });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).send('An error occurred while fetching statistics.');
  }
});




app.get('/profile', async (req, res) => {
  try {
    // Ensure that the user is authenticated
    if (!req.session.email) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const email = req.session.email;

    // Retrieve user data including username, email, and role
    const query = 'SELECT username, email, role FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Extract user data from the result
    const userData = result.rows[0];

    // Render the profile view with the user data
    res.render('profile', { userData }); // Rendering the profile.ejs template with userData
  } catch (err) {
    console.error('Error retrieving user information:', err);
    res.status(500).json({ success: false, error: 'Error fetching profile data' });
  }
});


// Route to render the page displaying active members
app.get('/active-members', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM active_members');
    const activeMembers = result.rows;
    client.release();
    res.render('active_members', { activeMembers });
  } catch (error) {
    console.error('Error fetching active members:', error);
    res.status(500).send('An error occurred while fetching active members.');
  }
});

// Route to delete an active member
app.post('/delete-member/:id', async (req, res) => {
  const memberId = req.params.id;
  try {
    const client = await pool.connect();
    await client.query('DELETE FROM active_members WHERE id = $1', [memberId]);
    client.release();
    res.redirect('/active-members');
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).send('An error occurred while deleting the member.');
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
