export function reservationPullProgress(reservations) {
  const total = reservations.length;
  const ready = reservations.filter(({ status }) => status === "ready").length;
  const unavailable = reservations.filter(({ status }) => status === "unavailable").length;
  return {
    total,
    ready,
    unavailable,
    remaining: Math.max(total - ready - unavailable, 0),
    complete: total > 0 && ready + unavailable === total,
  };
}

function bookTitles(reservations, itemById, status) {
  return reservations
    .filter((reservation) => reservation.status === status)
    .map((reservation) => itemById[String(reservation.item_id)]?.title || "Reserved book");
}

export function buildReservationPullMessage({ reservations, itemById }) {
  const customerName = reservations[0]?.customer_name?.trim() || "there";
  const readyTitles = bookTitles(reservations, itemById, "ready");
  const unavailableTitles = bookTitles(reservations, itemById, "unavailable");
  const paragraphs = [`Hi ${customerName},`];

  if (readyTitles.length > 0) {
    paragraphs.push(
      `Your IL HRC reservation is ready for pickup. We have set aside:\n${readyTitles.map((title) => `• ${title}`).join("\n")}`
    );
  }
  if (unavailableTitles.length > 0) {
    paragraphs.push(
      `Unfortunately, we were not able to set aside:\n${unavailableTitles.map((title) => `• ${title}`).join("\n")}`
    );
  }
  if (readyTitles.length > 0) {
    paragraphs.push(
      "Our address is 111 Fisk St. Goodfield, IL and we are typically open on Tuesdays from 12-4."
    );
    const expirationTimes = reservations
      .filter(({ status }) => status === "ready")
      .map(({ expires_at }) => new Date(expires_at).getTime())
      .filter(Number.isFinite);
    if (expirationTimes.length > 0) {
      const holdDate = new Date(Math.min(...expirationTimes)).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      paragraphs.push(`Your available books will be held through ${holdDate}.`);
    }
  }
  paragraphs.push("Please let us know if you have any questions.");
  paragraphs.push("Thanks!\nRebekah Schwind  |  Director");
  return paragraphs.join("\n\n");
}

export function preferredReservationContact(reservations) {
  const customer = reservations[0] || {};
  const preference = customer.preferred_contact || "either";
  if (preference === "phone") return { method: "Phone", value: customer.phone || "Not provided" };
  if (preference === "email") return { method: "Email", value: customer.email || "Not provided" };
  if (customer.email) return { method: "Either (email shown)", value: customer.email };
  return { method: "Either (phone shown)", value: customer.phone || "Not provided" };
}
