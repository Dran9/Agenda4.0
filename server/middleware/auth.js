const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  // EventSource (SSE) cannot send custom headers, so also accept ?token=…
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.split(' ')[1]
    : req.query?.token || null;

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.tenantId = decoded.tenantId;
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function generateToken(tenantId, userId) {
  return jwt.sign({ tenantId, userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { authMiddleware, generateToken };
