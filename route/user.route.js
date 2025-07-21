const dotenv = require("dotenv");
dotenv.config();
const router = require("express").Router();
const { check, validationResult } = require("express-validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../api/models/user.model");
const mongoose = require("mongoose");

router.post(
  "/login",
  [
    check("email", "Please add a valid email").isEmail(),
    check("password", "please enter a password").exists(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      let UserExists = await User.findOneAndUpdate(
        { email },
        { lastLogin: Date.now() }
      );

      if (!UserExists) {
        return res.status(400).json({ errors: [{ msg: "Email not found" }] });
      }

      const isMatch = await bcrypt.compare(password, UserExists.password);
      if (!isMatch) {
        return res
          .status(400)
          .json({ errors: [{ msg: "Password is not match" }] });
      }
      const token = jwt.sign({ id: UserExists._id }, process.env.JWT_KEY);

      res.status(200).json({
        token,
        isLogin: true,
      });
    } catch (e) {
      res.status(500).json({ res, e });
    }
  }
);

router.post(
  "/register",
  [
    check("email", "Please add a valid email").isEmail(),
    check("password", "please enter a password").isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      let user = await User.findOne({ email });

      if (user) {
        res.status(400).json({ errors: [{ msg: "User already exists" }] });
      }

      user = new User({
        email,
        password,
        _id: new mongoose.Types.ObjectId(),
      });

      const salt = await bcrypt.genSalt(10);

      user.password = await bcrypt.hash(password, salt);

      await user.save();
      res.send({
        email: user.email,
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server Error");
    }
  }
);

module.exports = router;
