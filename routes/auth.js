const router = require("express").Router();
const User = require("../models/user");
const cryptoJS = require("crypto-js");
const jwt = require("jsonwebtoken");
const crypto = require('crypto')
const sendEmail = require('../helpers/sendEmail');
const { createResetEmailHTML } = require("../helpers/orderConfrimation");




//Register
router.post("/register", async (req, res) => {
  if (req.body.password.length < 5 || req.body.password.length > 16 ) {
      return res.status(400).json({sucess: false,message: "password length should be in range of 5 to 16 charecter"})
  };
  const newUser = new User({
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    number: req.body.number,
    password: cryptoJS.AES.encrypt(req.body.password, process.env.CRYPTOJS_SECRET_KEY.toString()),
    userIP: req.body.userIP
  });
  try {
    const saveduser = await newUser.save();
    const {password, ...others} = saveduser._doc; 

    const accessToken = jwt.sign({
      id:saveduser._id, 
      isAdmin: saveduser.isAdmin,

    }, process.env.JWT_SECRET_KEY, {expiresIn: process.env.JWT_SECRET_EXPIRE || "3d"});


    res.status(201).json({...others, accessToken}); 
    
  } catch (err) {
      console.log(err)
      if(err.code === 11000) { 
        return res.status(400).json({sucess: false,message: "account with this email already exist"}) 
      } else if (err.name === "ValidationError") {
          if (err.name == 'ValidationError') {
            for (field in err.errors) {
              return res.status(400).json({sucess: false,message: err.errors[field].message}); 
            }
          }
      } else {
      console.log(`Logged Error from register user : ${err}`)
      return res.status(500).json({sucess: false,message: "internal server error"})
      }
  }
  
});

//login
router.post("/login", async (req, res) => {

  console.log(req.body)
  if(!req.body.email || !req.body.password) {
    return res.status(400).json({sucess: false,message: "please provide email and password"})
  }

  try {
    const user = await User.findOne({email: req.body.email});
      if (!user) {
        return res.status(401).json({sucess: false,message: "user with this emil dosent exist"})
      } 
      
      //checking if this login req is for admin
      if(req.body.forAdmin) {
        if (!user.isAdmin) {
          return res.status(401).json({sucess: false,message: "wrong credentials"}) 
        }
      }

      //matching pass
      const hashedpass = await cryptoJS.AES.decrypt(user.password, process.env.CRYPTOJS_SECRET_KEY);
      const pass = await hashedpass.toString(cryptoJS.enc.Utf8);
      console.log(`db pass = ${pass}`)
      console.log(`user pass = ${req.body.password}`)
      if(pass !== req.body.password) {
        return res.status(401).json({sucess: false,message: "wrong credentials"}) 
      }
      
      const accessToken = jwt.sign({
        id:user._id, 
        isAdmin: user.isAdmin,

      }, process.env.JWT_SECRET_KEY, {expiresIn: process.env.JWT_SECRET_EXPIRE || "3d"}); 
      
      const {password,resetPasswordToken,resetPasswordExpire, ...others} = user._doc
      res.status(200).json({...others, accessToken})
    
  } catch (err) {
    console.log(`Logged Error from login user : ${err}`)
    return res.status(500).json({ // Worked
      sucess: false,message: "Internal server error",
    });
    
  }
})


router.post("/forgotpass", async (req, res)=> {
  const email = req.body.email;
  if(!email) return res.status(400).json({sucess: false,message: "please provide a email"});

  const resetToken = crypto.randomBytes(20).toString('hex');
  const hashedresetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  const expireDate = Date.now() + (1000 * 60000);
  

  try {
    //finding if user and updating it
    const user = await User.findOneAndUpdate({email: email}, {
      resetPasswordToken: hashedresetPasswordToken,
      resetPasswordExpire: expireDate
    });

    if(!user) return res.status(401).json({sucess: false,message: "user with this email not exist"});
  
    //sending email thing
    const resetURl = `https://panarait.in/resetpassword/${resetToken}`;
    
    const emailtext = `
      you have requested a password reset
      please go tho this link to reset password
      ${resetURl}
    `
    const emailTemplate = createResetEmailHTML(user.firstName, resetURl)
    try {
      sendEmail({
        to: user.email,
        subject: "Forgot Password",
        emailhtml: emailTemplate,
        emailtext: emailtext
      })


    } catch (error) {
      //removing users reset token if its not valid
      await User.findOneAndUpdate({email: email}, {
        resetPasswordToken: undefined,
        resetPasswordExpire: undefined
      });
      console.log(error)
      return res.status(401).json({sucess: false,message: "Failed to send email"})
    }
    res.status(200).json({sucess: true,message: "Email send Sucessfully"})


  } catch (error) {
    console.log("mihir");
    
    return res.status(500).json(error)
  }
})

router.post("/resetpassword/:resetToken", async (req,res) => {
  const hashedresetPasswordToken = crypto.createHash("sha256").update(req.params.resetToken).digest("hex");
  try {

    //validating if this token is valid or not
    const user = await User.findOne({
      resetPasswordToken: hashedresetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() } 
    })

    if(!user) return res.status(400).json({ error: "Invalid reset token"});
    
    
    //checking if user is entering his old password
    const oldPassHAsh = cryptoJS.AES.decrypt(user.password, process.env.CRYPTOJS_SECRET_KEY);
    const oldPassword = oldPassHAsh.toString(cryptoJS.enc.Utf8);

    const newPassword = req.body.password;

    if(oldPassword === newPassword) {
      return res.status(401).json({error: "you can not add your current password"})
    }


    //setting saving new password to mongodb
    user.password = await cryptoJS.AES.encrypt(req.body.password, process.env.CRYPTOJS_SECRET_KEY.toString());
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({data: "password sucessfully changed"})

  } catch (error) {
    console.log(error)
    return res.status(500).json({error: "Internal server error"})
  }

})



module.exports = router;
