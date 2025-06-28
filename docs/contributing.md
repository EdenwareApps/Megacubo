<!-- docs/contributing.md -->

[🏠](/README.md) > [Contributing](contributing.md)

# <span style="color: #2e86de;">Contributing</span>

Thank you for considering contributing to **Megacubo**! Your help is essential to keeping the project alive and improving it for everyone.

There are many ways to contribute, whether you're a developer, translator, designer, or just a passionate user.

---

## Contributing Code

Megacubo is an open-source project hosted on GitHub at [github.com/EdenwareApps/megacubo](https://github.com/EdenwareApps/megacubo). 

### Understanding the Codebase

Before contributing code, familiarize yourself with the project structure:

- **Internal Modules**: Check out the [Internal Modules Documentation](../www/nodejs/modules/README.md) to understand how the different components work together
- **Module Architecture**: Each module is self-contained with its own documentation
- **Event-based Communication**: Modules communicate through Node.js EventEmitter
- **Shared Configuration**: Common settings managed through the config module

### Requirements

To build Megacubo locally, you'll need:
- Node.js (v14 or higher)
- Git installed and configured

### Steps to Contribute

1. **Fork the repository** on GitHub.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/EdenwareApps/Megacubo.git
   ```
3. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes** and test thoroughly.
5. **Commit your changes** with clear commit messages.
6. **Push to your fork** and create a pull request.

### Development Guidelines

- **Follow existing code style** and conventions
- **Write clear commit messages** in English
- **Update documentation** if needed

## Translating Megacubo

Help make Megacubo available in your language:

1. **Check existing translations** in the `www/nodejs/lang` folder
2. **Create or update** translation files
3. **Test the translation** in the app
4. **Submit a pull request** with your changes

### Translation Guidelines

- **Use clear, natural language**
- **Maintain consistency** with existing translations
- **Test UI elements** to ensure proper fit
- **Follow platform conventions** for your language

## Reporting Bugs

Found a bug? Help us fix it:

1. **Check existing issues** to avoid duplicates
2. **Create a new issue** with:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - System information (OS, version, etc.)
   - Screenshots if applicable

### Bug Report Template

```markdown
**Bug Description:**
[Clear description of the issue]

**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**System Information:**
- OS: [Windows/macOS/Linux/Android]
- Version: [Megacubo version]
- Device: [Device specifications]

**Additional Information:**
[Screenshots, logs, etc.]
```

## Feature Requests

Have an idea for a new feature?

1. **Search existing issues** to avoid duplicates
2. **Create a feature request** with:
   - Clear description of the feature
   - Use cases and benefits
   - Implementation suggestions (if any)
   - Priority level

## Documentation

Help improve our documentation:

- **Fix typos** and grammar errors
- **Add missing information**
- **Improve clarity** and organization
- **Translate documentation** to other languages

## Community Support

Help other users:

- **Answer questions** on GitHub Discussions
- **Help with troubleshooting**
- **Share your experiences** and tips
- **Welcome new contributors**

## Code of Conduct

We are committed to providing a welcoming and inclusive environment:

- **Be respectful** to all contributors
- **Use inclusive language**
- **Be patient** with newcomers
- **Focus on constructive feedback**

## Getting Help

Need help contributing?

- **Read the documentation** thoroughly
- **Ask questions** on GitHub Discussions
- **Email us** at contact@megacubo.tv
- **Facebook Page**: [facebook.com/MegacuboTV](https://www.facebook.com/MegacuboTV)
- **Contact maintainers** for guidance

---

*Every contribution, no matter how small, helps make Megacubo better for everyone. Thank you for your support!*

**Next:** [Legal Notice](legal.md)
**Previous:** [Support & Contact](support.md)