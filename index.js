const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.w1kojzp.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

function verifyJwt(req, res, next) {
    const authHeader = req.headers.authorization;
    console.log(authHeader)
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1]
    console.log(token)

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        console.log(token, err, decoded, 'jwt verify')
        if (err) {
            return res.status(401).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        const appointmentOptionsCollection = client.db('doctorsPortal').collection('appointmentOptions');
        const bookingCollection = client.db('doctorsPortal').collection('bookings');
        const usersCollection = client.db('doctorsPortal').collection('users');

        // this api is not used in client side.
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentOptionsCollection.find(query).toArray();

            //get the bookings of the provided date
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();

            //code carefully 
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlot = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlot.includes(slot))
                option.slots = remainingSlots;
                // console.log(date, option.name, remainingSlots.length)
            })
            res.send(options)
        })

        // v2 by mongodb
        app.get('/v2/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const options = await appointmentOptionsCollection.aggregate([
                {
                    $lookup:
                    {
                        from: 'bookings',
                        localField: 'name',
                        foreignField: 'treatment',
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$appointmentDate', date]
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: 1,
                        booked: {
                            $map: {
                                input: '$booked',
                                as: 'book',
                                in: '$$book.slot'
                            }
                        }
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: {
                            $setDifference: ['$slots', '$booked']
                        }
                    }
                }
            ]).toArray();
            res.send(options);
        })

        /**
        * API Naming Convention
        * app.get('/bookings')
        * app.get('/bookings/:id')
        * app.post('/bookings')
        * app.patch('/bookings/:id')
        * app.delete('/bookings/:id')
        */


        app.get('/bookings', verifyJwt, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(401).send({ message: 'forbidden access' })
            }

            const query = { email: email }
            const bookings = await bookingCollection.find(query).toArray();
            res.send(bookings)
        })

        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            console.log(booking)
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }

            const alreadyBooked = await bookingCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You have already booked on this ${booking.appointmentDate}`;
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingCollection.insertOne(booking);
            res.send(result);
        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            console.log(user)
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            console.log('/jwt')
            res.status(403).send({ accessToken: '' })

        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

    }
    finally {
    }
}
run().catch(console.dir);



app.get('/', async (req, res) => {
    res.send('Hello from doctors portal');
})

app.listen(port, () => {
    console.log(`Listen to port ${port}`)
})