function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function customerIdentityTokens(reservation) {
  const tokens = [];
  const email = normalizeText(reservation.email);
  const phone = normalizePhone(reservation.phone);
  const name = normalizeText(reservation.customer_name);

  if (email) tokens.push(`email:${email}`);
  if (phone) tokens.push(`phone:${phone}`);
  if (name && !email && !phone) tokens.push(`name:${name}`);
  return tokens;
}

function reservationTime(reservation) {
  const timestamp = new Date(reservation.created_at || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Groups reservations that share an email or phone. The merge is transitive, so
 * a reservation with both contact methods joins email-only and phone-only rows.
 */
export function groupReservationsByCustomer(reservations) {
  const groups = [];
  const tokenToGroup = new Map();

  [...reservations]
    .sort((left, right) => reservationTime(left) - reservationTime(right))
    .forEach((reservation) => {
      const tokens = customerIdentityTokens(reservation);
      const matchingGroups = [...new Set(tokens.map((token) => tokenToGroup.get(token)).filter(Boolean))];
      let group = matchingGroups[0];

      if (!group) {
        group = { reservations: [], tokens: new Set() };
        groups.push(group);
      }

      for (const duplicateGroup of matchingGroups.slice(1)) {
        group.reservations.push(...duplicateGroup.reservations);
        duplicateGroup.tokens.forEach((token) => {
          group.tokens.add(token);
          tokenToGroup.set(token, group);
        });
        groups.splice(groups.indexOf(duplicateGroup), 1);
      }

      group.reservations.push(reservation);
      tokens.forEach((token) => {
        group.tokens.add(token);
        tokenToGroup.set(token, group);
      });
    });

  return groups
    .map(({ reservations: groupedReservations }) => ({
      customer: groupedReservations[0],
      reservations: groupedReservations,
    }))
    .sort((left, right) =>
      String(left.customer.customer_name || "").localeCompare(String(right.customer.customer_name || ""), undefined, {
        sensitivity: "base",
      })
    );
}

