// ORDER VALIDATION
export function validateOrder(data) {
    if (!data.customerName?.trim()) {
        return {
            valid: false,
            message: `Customer name is required.`
        }
    }

    if (!data.customerPhone?.trim()) {
        return {
            valid: false,
            message: `Customer phone is required.`
        }
    }

    if (!data.customerAddress?.trim()) {
        return {
            valid: false,
            message: `Customer address is required.`
        }
    }

    if (!Array.isArray(data.items)) {
        return {
            valid: false,
            message: `Order must have at least one item.`
        }
    }

    return {
        valid: true
    }
}

// ORDER ID GENERATOR -> FORMAT: ORD-20260321-001
export function generateOrderId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const orderId = Math.floor(Math.random() * 1000).toString().padStart(3, "0");

    return `ORD-${year}${month}${day}-${orderId}`
}