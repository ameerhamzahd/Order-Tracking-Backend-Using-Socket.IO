import { ReturnDocument } from "mongodb";
import { getCollection } from "../config/database.js";
import { calculateTotal, createOrder, generateOrderId, isValidStatusTransition } from "../utils/helper.js";

export const orderHandler = (io, socket) => {
    console.log("A user connected", socket.id);

    // EMIT -> TRIGGER -> ON -> LISTEN

    // CUSTOMER -> PLACE ORDER
    socket.on("placeOrder", async (data, callback) => {
        try {
            console.log(`Placed order from ${socket.id}`);

            const validation = validateOrder(data);

            if (!validation.valid) {
                callback({
                    success: false,
                    message: validation.message
                });
            }

            const totals = calculateTotal(data.items);
            const orderId = generateOrderId();
            const order = createOrder(data, orderId, totals);

            const ordersCollection = getCollection("orders");
            await ordersCollection.insertOne(order);

            socket.join(`order-${orderId}`);
            socket.join(`customers`);

            io.to("admins").emit("newOrder", {
                order
            });

            callback({
                success: true,
                order
            });
            console.log(`Order created: ${orderId}`)
        } catch (error) {
            console.log(error);
            callback({
                success: false,
                message: "Failed to place order..."
            })
        }
    });

    // CUSTOMER -> TRACK ORDER
    socket.on("trackOrder", async (data, callback) => {
        try {
            const ordersCollection = getCollection("orders");
            const order = await ordersCollection.findOne({
                orderId: data.orderId
            });

            if (!order) {
                return callback({
                    success: false,
                    message: "Order not found"
                });
            }

            socket.join(`order-${data.orderId}`);
            callback({
                success: true,
                order
            });
        } catch (error) {
            console.error("Order tracking error", error);
            callback({
                success: false,
                message: error.message
            });
        }
    })

    // CUSTOMER -> CANCEL ORDER
    socket.on("cancelOrder", async (data, callback) => {
        try {
            const ordersCollection = getCollection("orders");
            const order = await ordersCollection.findOne({
                orderId: data.orderId
            });

            if (!order) {
                return callback({
                    success: false,
                    message: "Order not found"
                });
            }

            if (!['pending', 'confirmed'].includes(order.status)) {
                return callback({
                    success: false,
                    message: "Can not cancel the order."
                })
            }

            await ordersCollection.updateOne(
                {
                    orderId: data.orderId
                },
                {
                    $set: {
                        status: 'cancelled',
                        updatedAt: new Date()
                    },
                    $push: {
                        statusHistory: {
                            satus: "cancelled",
                            timestamp: new Date(),
                            by: socket.id,
                            note: data.reason || "Cancelled by customer"
                        }
                    }
                }
            )

            io.to(`order-${data.orderId}`).emit("orderCancelled", {
                orderId: data.orderId
            });
            io.to("admins").emit("orderCancelled", {
                orderId: data.orderId,
                customerName: order.customerName
            })

            callback({
                success: true
            })
        } catch (error) {
            console.error("Order cancelling error", error);
            callback({
                success: false,
                message: error.message
            });
        }
    })

    // CUSTOMER -> GET MY ALL ORDERS
    socket.on("getMyOrders", async (data, callback) => {
        try {
            const ordersCollection = getCollection("orders");
            const orders = await ordersCollection.find({
                customerPhone: data.customerPhone
            }).sort({
                createdAt: -1
            }).limit(20).toArray();

            callback({
                success: true,
                orders
            })
        } catch (error) {
            console.error("Orders getting error", error);
            callback({
                success: false,
                message: error.message
            });
        }
    })

    // ADMIN -> LOGIN
    socket.on("adminLogin", async (data, callback) => {
        try {
            if (data.password === process.env.ADMIN_PASSWORD) {
                socket.isAdmin = true;
                socket.join("admins");

                console.log(`admin logged in: ${socket.id}`);

                callback({
                    success: true
                })
            } else {
                callback({
                    success: false,
                    message: "Invalid credensials"
                })
            }
        } catch (error) {
            callback({
                success: false,
                message: "Login failed"
            })
        }
    })

    // ADMIN -> GET ALL ORDERS
    socket.on("getAllOrders", async (data, callback) => {
        try {
            if (!socket.isAdmin) {
                return callback({
                    success: false,
                    message: "Unauthorized"
                })
            }

            const ordersCollection = getCollection("orders");
            const filter = data?.status ? { status: data.status } : {};
            const orders = await ordersCollection.find(filter).sort({ createdAt: -1 }).limit(20).toArray();

            callback({
                success: true,
                orders
            });
        } catch (error) {
            callback({
                success: false,
                message: "Failed to retrive all orders"
            })
        }
    });

    // ADMIN -> UPDATE ORDER STATUS
    socket.on("updateOrderStatus", async (data, callback) => {
        try {
            const ordersCollection = getCollection("orders");
            const order = await ordersCollection.findOne({
                orderId: data.orderId
            })

            if (!order) {
                return callback({
                    success: false,
                    message: "Order not found"
                });
            }

            if (!isValidStatusTransition(order.status, data.newStatus)) {
                return callback({
                    success: false,
                    message: "Invalid status transition"
                })
            }

            const queryResult = await ordersCollection.findOneAndUpdate(
                {
                    orderId: data.orderId
                },
                {
                    $set: { 
                        status: data.newStatus, 
                        updatedAt: new Date() 
                    },
                    $push: {
                        statusHistory: {
                            status: data.newStatus,
                            timestamp: new Date(),
                            by: socket.id,
                            note: "Status updated by admin"
                        }
                    }
                },
                {
                    returnDocument: 'after'
                }
            )

            io.to(`order-${data.orderId}`).emit('statusUpdated', {
                orderId: data.orderId,
                status: data.newStatus,
                order: queryResult
            })

            socket.to("admins").emit("orderStatusChanged", {
                orderId: data.orderId,
                newStatus: data.newStatus
            });

            callback({
                success: true,
                order: queryResult
            })
        } catch (error) {
            callback({
                success: false,
                message: "Failed to update order status"
            })
        }
    })

    // ADMIN -> ACCEPT ORDER
    socket.on("acceptOrder", async (data, callback) => {
        try {
            if (!socket.isAdmin) {
                return callback({
                    success: false,
                    message: "Unauthorized"
                })
            }

            const ordersCollection = getCollection("orders");
            const order = await ordersCollection.findOne({
                orderId: data.orderId
            });

            if (!order || order.status !== "pending") {
                return callback({
                    success: false,
                    message: "Can't accept the order"
                })
            }

            const estimatedTime = data.estimatedTime || 30;
            const queryResult = await ordersCollection.findOneAndUpdate(
                {
                    orderId: data.orderId
                },
                {
                    $set: { 
                        status: "confirmed", 
                        estimatedTime,
                        updatedAt: new Date()  
                    },
                    $push: {
                        statusHistory: {
                            status: "confirmed",
                            timestamp: new Date(),
                            by: socket.id,
                            note: `Accepted with ${estimatedTime}min estimated time`
                        }
                    }
                },
                {
                    returnDocument: 'after'
                }
            )

            io.to(`order-${data.orderId}`).emit('orderAccepted', {
                orderId: data.orderId,
                estimatedTime
            });

            socket.on("admins").emit("orderAcceptedByAdmin", {
                orderId: data.orderId
            });

            callback({
                success: true,
                order: queryResult
            });
        } catch (error) {
            callback({
                success: false,
                message: error.message
            })
        }
    })
};