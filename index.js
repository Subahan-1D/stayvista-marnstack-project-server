const express = require("express");
const app = express();
require("dotenv").config();
const nodemailer = require("nodemailer");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  Timestamp,
} = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.VITE_STRIPE_SECRET_KEY);
const port = process.env.PORT || 8000;

// config
// middleware
const corsOptions = {
  origin: ["http://localhost:5173","grandview-hotel-management.firebaseapp.com"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// send email to node mailer
const sendEmail = (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // true for port 465, false for other ports
    auth: {
      user:process.env.TRANSPORTER_EMAIL,
      pass:process.env.TRANSPORTER_PASS,
    },
  });
  // verify connection configuration transporter
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error);
    } else {
      console.log("Server is ready to take our messages");
    }
  });

  const mailBody = {
    from: `"MansionHotels" <${process.env.TRANSPORTER_EMAIL}>`, // sender address
    to: emailAddress, // list of receivers
    subject: emailData.subject, // Subject line
    html: emailData.message, // html body
  };
  // send mail with defined transport object
  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email Sent :" + info.response);
    }
  });
};

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  console.log("Hello Admin");
  const token = req.cookies?.token;
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_US}:${process.env.DB_PASS}@cluster0.yqmtelq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await userCollection.findOne(query);
      console.log(result?.role);
      if (!result || result?.role !== "admin")
        return res.status(403).send({ message: "forbidden access!!" });
      next();
    };
    // verify host
    const verifyHost = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await userCollection.findOne(query);
      console.log(result?.role);
      if (!result || result?.role !== "host")
        return res.status(403).send({ message: "forbidden access" });
      next();
    };
    const db = client.db("stayvista");
    const roomCollection = db.collection("rooms");
    const userCollection = db.collection("users");
    const bookingCollection = db.collection("bookings");
    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });
    // save a user data in db
    app.put("/user", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      // check if user already exists in db
      const isExist = await userCollection.findOne(query);
      if (isExist) {
        if (user.status === "Requested") {
          // if existing user try to change his role
          const result = await userCollection.updateOne(query, {
            $set: { status: user?.status },
          });
          return res.send(result);
        } else {
          // if existing user login again
          return res.send(isExist);
        }
      }
      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await userCollection.updateOne(query, updateDoc, options);
      // welcome to new user 
      sendEmail(user?.email, {
        subject: "Welcome to Grandview Mansion Hotels!",
        message: `Hope you will find you destination.`,
      });
      res.send(result);
    });
    // part 3 get a user info by  email from db
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send(result);
    });

    // get all user data from db
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // update user role
    app.patch("/users/update/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // Get all rooms from db
    app.get("/rooms", async (req, res) => {
      const category = req.query.category;
      console.log(category);
      let query = {};
      if (category && category !== "null") query = { category };
      const result = await roomCollection.find(query).toArray();
      res.send(result);
    });
    // save a room add db
    app.post("/room", verifyToken, verifyHost, async (req, res) => {
      const roomData = req.body;
      const result = await roomCollection.insertOne(roomData);
      res.send(result);
    });

    // get all rooms for host
    app.get(
      "/my-listings/:email",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const email = req.params.email;
        let query = { "host.email": email };
        const result = await roomCollection.find(query).toArray();
        res.send(result);
      }
    );

    // Get single data from data using _id
    app.get("/room/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await roomCollection.findOne(query);
      res.send(result);
    });

    // delete a room
    app.delete("/room/:id", verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await roomCollection.deleteOne(query);
      res.send(result);
    });

    // create payment intent stripe
    // 1st step
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "inside the intent");
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // 2nd data save booking  collection

    app.post("/booking", verifyToken, async (req, res) => {
      const bookingData = req.body;
      // save room booking info from db
      const result = await bookingCollection.insertOne(bookingData);
      // send a email to guest
        sendEmail(bookingData?.guest?.email, {
          subject: "Booking Successful!",
          message: `You've successfully booked a room through MansionHotels. Transaction Id: ${bookingData?.transitionId}`,
        });
        // send email to host
        sendEmail(bookingData?.host?.email, {
          subject: "Your room got booked!",
          message: `Get ready to welcome ${bookingData?.guest?.name}.`,
        });
      res.send(result);
    });

    // update room status
    app.patch("/room/status/:id", async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { booked: status },
      };
      const result = await roomCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // get all room booking for guest
    app.get("/my-bookings/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "guest.email": email };
      const result = await bookingCollection.find(query).toArray();
      res.send(result);
    });
    // get all room booking for host
    app.get(
      "/manage-bookings/:email",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const email = req.params.email;
        const query = { "host.email": email };
        const result = await bookingCollection.find(query).toArray();
        res.send(result);
      }
    );

    // delete a my booking data
    app.delete("/booking/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.deleteOne(query);
      res.send(result);
    });

    // sales admin statics page
    app.get("/admin-stat", verifyToken, verifyAdmin, async (req, res) => {
      const bookingDetails = await bookingCollection
        .find(
          {},
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray();
      const totalUsers = await userCollection.countDocuments();
      const totalRooms = await roomCollection.countDocuments();
      const totalPrice = bookingDetails.reduce(
        (sum, booking) => sum + booking.price,
        0
      );
      const chartData = bookingDetails.map((booking) => {
        const day = new Date(booking.date).getDate();
        const month = new Date(booking.date).getMonth() + 1;
        const data = [`${day} / ${month}`, booking?.price];
        return data;
      });
      chartData.unshift(["Day", "Sales"]);
      console.log(chartData);
      console.log(bookingDetails);
      res.send({
        totalUsers,
        totalRooms,
        totalBookings: bookingDetails.length,
        totalPrice,
        chartData,
      });
    });
    // sales host statics page
    app.get("/host-stat", verifyToken, verifyHost, async (req, res) => {
      const { email } = req.user;
      const bookingDetails = await bookingCollection
        .find(
          { "host.email": email },
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray();
      const totalRooms = await roomCollection.countDocuments({
        "host.email": email,
      });
      const totalPrice = bookingDetails.reduce(
        (sum, booking) => sum + booking.price,
        0
      );
      const { timestamp } = await userCollection.findOne(
        { email },
        {
          projection: {
            timestamp: 1,
          },
        }
      );
      const chartData = bookingDetails.map((booking) => {
        const day = new Date(booking.date).getDate();
        const month = new Date(booking.date).getMonth() + 1;
        const data = [`${day} / ${month}`, booking?.price];
        return data;
      });
      chartData.unshift(["Day", "Sales"]);
      console.log(chartData);
      console.log(bookingDetails);
      res.send({
        hostSince: timestamp,
        totalRooms,
        totalBookings: bookingDetails.length,
        totalPrice,
        chartData,
      });
    });
    // sales guest statics page
    app.get("/guest-stat", verifyToken, async (req, res) => {
      const { email } = req.user;
      const bookingDetails = await bookingCollection
        .find(
          { "guest.email": email },
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray();
      const totalRooms = await roomCollection.countDocuments({
        "host.email": email,
      });
      const totalPrice = bookingDetails.reduce(
        (sum, booking) => sum + booking.price,
        0
      );
      const { timestamp } = await userCollection.findOne(
        { email },
        {
          projection: {
            timestamp: 1,
          },
        }
      );
      const chartData = bookingDetails.map((booking) => {
        const day = new Date(booking.date).getDate();
        const month = new Date(booking.date).getMonth() + 1;
        const data = [`${day} / ${month}`, booking?.price];
        return data;
      });
      chartData.unshift(["Day", "Sales"]);
      console.log(chartData);
      console.log(bookingDetails);
      res.send({
        hostSince: timestamp,
        totalRooms,
        totalBookings: bookingDetails.length,
        totalPrice,
        chartData,
      });
    });

    // last update room data
    app.put("/room/update/:id", verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const roomData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: roomData,
      };
      const result = await roomCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello Grand View Hotels Server..");
});

app.listen(port, () => {
  console.log(`Grand View Hotels is running on port ${port}`);
});
